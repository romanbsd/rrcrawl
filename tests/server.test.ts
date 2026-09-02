import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { RoundRobinRouter } from "../src/router.js";
import { createServer } from "../src/server.js";

const testConfig: AppConfig = {
  authMode: "env",
  providers: ["firecrawl"],
  requestTimeoutMs: 60_000,
  crawlTimeoutMs: 180_000,
  pollIntervalMs: 2_000,
  extractConcurrency: 4,
  firecrawl: { apiUrl: "https://api.firecrawl.dev" },
  tavily: { apiUrl: "https://api.tavily.com" },
  scrapedo: { apiUrl: "https://api.scrape.do/" },
};

describe("MCP server", () => {
  const closeables: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((closeable) => closeable.close()));
  });

  async function connect(server: ReturnType<typeof createServer>) {
    const client = new Client({ name: "rrcrawl-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    return client;
  }

  it("advertises the tool surface in preference order", async () => {
    const router = new RoundRobinRouter(
      [{ name: "firecrawl", scrape: vi.fn() }],
      [],
    );
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const listed = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "extract",
      "crawl",
      "scrape",
    ]);
    for (const tool of listed.tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it("invokes scrape end to end as a compatibility wrapper", async () => {
    const scrape = vi.fn(async ({ url }: { url: string }) => ({
      provider: "firecrawl" as const,
      url,
      title: "Example",
      markdown: "# Example",
    }));
    const router = new RoundRobinRouter(
      [{ name: "firecrawl", scrape }],
      [],
    );
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "scrape",
          arguments: { url: "https://example.com" },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      provider: "firecrawl",
      url: "https://example.com/",
      title: "Example",
      markdown: "# Example",
    });
    expect(scrape).toHaveBeenCalledOnce();
  });

  it("invokes extract end to end", async () => {
    const scrape = vi.fn(async ({ url }: { url: string }) => ({
      provider: "firecrawl" as const,
      url,
      title: "Example",
      markdown: "# Example",
    }));
    const router = new RoundRobinRouter(
      [{ name: "firecrawl", scrape }],
      [],
    );
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "extract",
          arguments: { urls: ["https://example.com"] },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      pages: [
        {
          requestedUrl: "https://example.com/",
          url: "https://example.com/",
          title: "Example",
          markdown: "# Example",
          provider: "firecrawl",
          cached: false,
          truncated: false,
          originalChars: 9,
          returnedChars: 9,
        },
      ],
      failures: [],
    });
    const text = result.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("");
    expect(text).toContain("# Example");
    expect(text).toContain("Source: https://example.com/");
    expect(text).not.toContain('"provider"');
  });

  it("returns partial failure without isError when some pages succeed", async () => {
    const scrape = vi.fn(async ({ url }: { url: string }) => {
      if (url === "https://example.com/good") {
        return {
          provider: "firecrawl" as const,
          url,
          markdown: "# Good",
        };
      }
      throw new Error("boom");
    });
    const router = new RoundRobinRouter([{ name: "firecrawl", scrape }], []);
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "extract",
          arguments: {
            urls: ["https://example.com/good", "https://example.com/bad"],
          },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as {
      pages: Array<{ url: string }>;
      failures: Array<{ url: string; error: string }>;
    };
    expect(structured.pages.map((page) => page.url)).toEqual([
      "https://example.com/good",
    ]);
    expect(structured.failures).toHaveLength(1);
    expect(structured.failures[0].url).toBe("https://example.com/bad");
    expect(structured.failures[0].error).toContain("boom");
  });

  it("marks extract isError when every URL fails", async () => {
    const scrape = vi.fn(async () => {
      throw new Error("boom");
    });
    const router = new RoundRobinRouter([{ name: "firecrawl", scrape }], []);
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "extract",
          arguments: { urls: ["https://example.com/1", "https://example.com/2"] },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { failures: unknown[] };
    expect(structured.failures).toHaveLength(2);
  });

  it("rejects relevant mode until relevance extraction ships", async () => {
    const scrape = vi.fn();
    const router = new RoundRobinRouter([{ name: "firecrawl", scrape }], []);
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "extract",
          arguments: {
            urls: ["https://example.com"],
            mode: "relevant",
            query: "credentials",
          },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
    expect(scrape).not.toHaveBeenCalled();
  });

  it("invokes crawl end to end with parsed defaults", async () => {
    const crawl = vi.fn(async () => ({
      provider: "tavily" as const,
      pages: [{ url: "https://example.com/docs/1", markdown: "# Doc" }],
    }));
    const router = new RoundRobinRouter(
      [{ name: "firecrawl", scrape: vi.fn() }],
      [{ name: "tavily", crawl }],
    );
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "crawl",
          arguments: { url: "https://example.com/docs", limit: 5 },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      provider: "tavily",
      pages: [{ url: "https://example.com/docs/1", markdown: "# Doc" }],
    });
    expect(crawl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
      limit: 5,
      maxDepth: 1,
      includePaths: [],
      allowExternal: false,
    });
  });

  it("returns an error result when the router reports failure", async () => {
    const scrape = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const router = new RoundRobinRouter([{ name: "firecrawl", scrape }], []);
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "scrape",
          arguments: { url: "https://example.com" },
        },
      },
      CallToolResultSchema,
    );
    const text = result.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("");
    expect(text).toContain("rate limited");
  });

  it("rejects non-HTTP URLs before reaching the provider", async () => {
    const scrape = vi.fn();
    const router = new RoundRobinRouter([{ name: "firecrawl", scrape }], []);
    const server = createServer(router, "0.1.0", testConfig);
    const client = await connect(server);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "scrape",
          arguments: { url: "file:///etc/passwd" },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
    const text = result.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("");
    expect(text).toContain("must be an HTTP or HTTPS URL");
    expect(scrape).not.toHaveBeenCalled();
  });
});