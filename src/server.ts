import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { FirecrawlProvider } from "./providers/firecrawl.js";
import { ScrapeDoProvider } from "./providers/scrapedo.js";
import { TavilyProvider } from "./providers/tavily.js";
import { RoundRobinRouter } from "./router.js";
import type {
  CrawlProvider,
  ScrapeProvider,
} from "./types.js";

const pageSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  markdown: z.string(),
});

function toErrorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

export function createRouter(config: AppConfig): RoundRobinRouter {
  const scrapeProviders: ScrapeProvider[] = [];
  const crawlProviders: CrawlProvider[] = [];

  if (config.providers.includes("firecrawl")) {
    const provider = new FirecrawlProvider({
      ...config.firecrawl,
      requestTimeoutMs: config.requestTimeoutMs,
      crawlTimeoutMs: config.crawlTimeoutMs,
      pollIntervalMs: config.pollIntervalMs,
    });
    scrapeProviders.push(provider);
    crawlProviders.push(provider);
  }
  if (config.providers.includes("tavily")) {
    const provider = new TavilyProvider({
      ...config.tavily,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    scrapeProviders.push(provider);
    crawlProviders.push(provider);
  }
  if (config.providers.includes("scrapedo")) {
    scrapeProviders.push(
      new ScrapeDoProvider({
        ...config.scrapedo,
        requestTimeoutMs: config.requestTimeoutMs,
      }),
    );
  }

  return new RoundRobinRouter(scrapeProviders, crawlProviders);
}

export function createServer(router: RoundRobinRouter): McpServer {
  const server = new McpServer({
    name: "rrcrawl",
    version: "0.1.0",
  });

  server.registerTool(
    "scrape",
    {
      title: "Scrape one URL",
      description:
        "Fetch one URL as normalized Markdown. Requests rotate across all configured providers and fail over on errors.",
      inputSchema: {
        url: z.string().url().describe("HTTP or HTTPS URL to scrape"),
      },
      outputSchema: pageSchema.extend({
        provider: z.enum(["firecrawl", "tavily", "scrapedo"]),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      try {
        const result = await router.scrape({ url });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: {
            provider: result.provider,
            url: result.url,
            ...(result.title ? { title: result.title } : {}),
            markdown: result.markdown,
          },
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "crawl",
    {
      title: "Crawl a website",
      description:
        "Crawl multiple pages as normalized Markdown. Requests rotate between configured crawl-capable providers (Firecrawl and Tavily) and fail over on errors.",
      inputSchema: {
        url: z.string().url().describe("Root HTTP or HTTPS URL"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe("Maximum number of pages"),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(1)
          .describe("Maximum link depth from the root URL"),
        includePaths: z
          .array(z.string())
          .max(20)
          .default([])
          .describe("Provider-compatible regex path filters"),
        allowExternal: z
          .boolean()
          .default(false)
          .describe("Allow pages outside the root domain"),
        instructions: z
          .string()
          .max(2_000)
          .optional()
          .describe("Natural-language guidance for selecting pages"),
      },
      outputSchema: z.object({
        provider: z.enum(["firecrawl", "tavily"]),
        pages: z.array(pageSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      url,
      limit,
      maxDepth,
      includePaths,
      allowExternal,
      instructions,
    }) => {
      try {
        const result = await router.crawl({
          url,
          limit,
          maxDepth,
          includePaths,
          allowExternal,
          instructions,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: {
            provider: result.provider,
            pages: result.pages,
          },
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  return server;
}

export async function runServer(config: AppConfig): Promise<void> {
  const server = createServer(createRouter(config));
  await server.connect(new StdioServerTransport());
}
