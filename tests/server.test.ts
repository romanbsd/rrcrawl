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
    const server = createServer(router);
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
});
