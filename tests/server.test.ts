import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoundRobinRouter } from "../src/router.js";
import { createServer } from "../src/server.js";

describe("MCP server", () => {
  const closeables: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((closeable) => closeable.close()));
  });

  it("advertises the two-tool surface and invokes scrape end to end", async () => {
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
    const server = createServer(router, "0.1.0");
    const client = new Client({ name: "rrcrawl-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    expect(listed.tools.map((tool) => tool.name)).toEqual(["scrape", "crawl"]);

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
      url: "https://example.com",
      title: "Example",
      markdown: "# Example",
    });
    expect(scrape).toHaveBeenCalledOnce();
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
    const server = createServer(router, "0.1.0");
    const client = new Client({ name: "rrcrawl-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

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
    const server = createServer(router, "0.1.0");
    const client = new Client({ name: "rrcrawl-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

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
    const server = createServer(router, "0.1.0");
    const client = new Client({ name: "rrcrawl-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

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
