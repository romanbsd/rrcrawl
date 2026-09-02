import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { renderExtractResult } from "./content/render.js";
import { ExtractService } from "./extract.js";
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

// The tool descriptions promise HTTP(S) only; z.string().url() alone would
// accept ftp:// or file:// which providers may not scrape correctly.
const httpUrl = z
  .string()
  .url()
  .regex(/^https?:\/\//i, "must be an HTTP or HTTPS URL");

const extractedPageSchema = z.object({
  requestedUrl: z.string().url(),
  url: z.string().url(),
  title: z.string().optional(),
  markdown: z.string(),
  // Provider is a string (not an enum) so adding providers doesn't require a
  // public schema change.
  provider: z.string(),
  cached: z.boolean(),
  truncated: z.boolean(),
  originalChars: z.number().int().nonnegative().optional(),
  returnedChars: z.number().int().nonnegative(),
});

const extractFailureSchema = z.object({
  url: z.string().url(),
  error: z.string(),
  code: z.string().optional(),
  attemptedProviders: z.array(z.string()).default([]),
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

export function createServer(
  router: RoundRobinRouter,
  version: string,
  config: AppConfig,
): McpServer {
  const extract = new ExtractService(router, config.extractConcurrency);
  const server = new McpServer({
    name: "rrcrawl",
    version,
  });

  server.registerTool(
    "extract",
    {
      title: "Extract content from one or more URLs",
      description:
        "Read and extract the contents of one or more HTTP/HTTPS URLs.\n" +
        "\n" +
        "Use this when you already know which pages or resources you need to inspect.\n" +
        "It is suitable for reading, quoting, summarizing, comparing, or gathering\n" +
        "evidence from known URLs.\n" +
        "\n" +
        "Prefer this over browser automation unless interaction with the page,\n" +
        "live DOM state, authentication, or browser-only behavior is required.\n" +
        "\n" +
        "Provider selection, retries, normalization, and failover are handled automatically.\n" +
        "Partial failures return the successful pages alongside structured failures.",
      inputSchema: {
        urls: z
          .array(httpUrl)
          .min(1)
          .max(20)
          .describe("HTTP or HTTPS URLs to read"),
        query: z
          .string()
          .max(1_000)
          .optional()
          .describe(
            "Optional description of the information needed from these pages; " +
              "relevance-aware reduction is not yet available",
          ),
        mode: z
          .enum(["full", "relevant"])
          .default("full")
          .describe(
            "full returns normalized content subject to output limits; " +
              "relevant mode is not yet available",
          ),
        maxCharsPerPage: z
          .number()
          .int()
          .min(1_000)
          .max(100_000)
          .default(30_000)
          .describe("Maximum text returned for each page"),
        maxTotalChars: z
          .number()
          .int()
          .min(2_000)
          .max(250_000)
          .default(100_000)
          .describe("Maximum text returned across the entire tool call"),
        fresh: z
          .boolean()
          .default(false)
          .describe(
            "Bypass cached content and fetch fresh results " +
              "(caching is not yet available)",
          ),
      },
      outputSchema: z.object({
        pages: z.array(extractedPageSchema),
        failures: z.array(extractFailureSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const result = await extract.extract(input);
        return {
          content: [{ type: "text", text: renderExtractResult(result) }],
          structuredContent: {
            pages: result.pages,
            failures: result.failures,
          },
          isError: result.pages.length === 0,
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
        "Discover and read multiple related pages from a website.\n" +
        "\n" +
        "Use this when the information you need is spread across a site's\n" +
        "documentation, knowledge base, product pages, or other linked pages.\n" +
        "\n" +
        "Use `extract` instead when one or a small known set of URLs is sufficient.\n" +
        "\n" +
        "Provider selection, retries, and failover are handled automatically.",
      inputSchema: {
        url: httpUrl.describe("Root HTTP or HTTPS URL"),
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

  server.registerTool(
    "scrape",
    {
      title: "Read one URL",
      description:
        "Read one HTTP/HTTPS URL as normalized Markdown.\n" +
        "\n" +
        "Compatibility alias for single-page extraction. New clients should prefer\n" +
        "`extract`, which supports batching and output controls.",
      inputSchema: {
        url: httpUrl.describe("HTTP or HTTPS URL to read"),
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
        const result = await extract.extract({
          urls: [url],
          query: undefined,
          mode: "full",
          maxCharsPerPage: 30_000,
          maxTotalChars: 100_000,
          fresh: false,
        });
        const page = result.pages[0];
        if (!page) {
          const failure = result.failures[0];
          return toErrorResult(
            new Error(failure?.error ?? "extraction failed"),
          );
        }
        return {
          content: [{ type: "text", text: renderExtractResult(result) }],
          structuredContent: {
            provider: page.provider,
            url: page.url,
            ...(page.title ? { title: page.title } : {}),
            markdown: page.markdown,
          },
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  return server;
}

export async function runServer(
  config: AppConfig,
  version: string,
): Promise<void> {
  const server = createServer(createRouter(config), version, config);
  await server.connect(new StdioServerTransport());
}