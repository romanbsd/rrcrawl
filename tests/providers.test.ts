import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/http.js";
import { FirecrawlProvider } from "../src/providers/firecrawl.js";
import { ScrapeDoProvider } from "../src/providers/scrapedo.js";
import { TavilyProvider } from "../src/providers/tavily.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("provider adapters", () => {
  it("normalizes a Firecrawl scrape and sends bearer auth", async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        data: {
          markdown: "# Page",
          metadata: { sourceURL: "https://example.com/page", title: "Page" },
        },
      }),
    );
    const provider = new FirecrawlProvider({
      apiUrl: "https://firecrawl.test",
      apiKey: "secret",
      requestTimeoutMs: 1000,
      crawlTimeoutMs: 1000,
      pollIntervalMs: 1,
      fetchFn,
    });

    await expect(
      provider.scrape({ url: "https://example.com" }),
    ).resolves.toEqual({
      provider: "firecrawl",
      url: "https://example.com/page",
      title: "Page",
      markdown: "# Page",
    });
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
  });

  it("submits and polls a Firecrawl crawl", async () => {
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "completed",
          data: [
            {
              markdown: "# One",
              metadata: { sourceURL: "https://example.com/one" },
            },
          ],
        }),
      );
    const provider = new FirecrawlProvider({
      apiUrl: "https://firecrawl.test",
      requestTimeoutMs: 1000,
      crawlTimeoutMs: 1000,
      pollIntervalMs: 1,
      fetchFn,
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      provider.crawl({
        url: "https://example.com",
        limit: 5,
        maxDepth: 2,
        includePaths: ["/docs/.*"],
        allowExternal: false,
      }),
    ).resolves.toMatchObject({
      provider: "firecrawl",
      pages: [{ url: "https://example.com/one", markdown: "# One" }],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("normalizes Tavily extraction", async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        results: [
          { url: "https://example.com", raw_content: "# Tavily" },
        ],
      }),
    );
    const provider = new TavilyProvider({
      apiUrl: "https://tavily.test",
      requestTimeoutMs: 1000,
      fetchFn,
    });

    await expect(
      provider.scrape({ url: "https://example.com" }),
    ).resolves.toEqual({
      provider: "tavily",
      url: "https://example.com",
      markdown: "# Tavily",
    });
  });

  it("omits Scrape.do token in OneCLI mode", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => new Response("# Scrape.do"));
    const provider = new ScrapeDoProvider({
      apiUrl: "https://api.scrape.do/",
      requestTimeoutMs: 1000,
      fetchFn,
    });

    await provider.scrape({ url: "https://example.com" });
    const requestedUrl = String(fetchFn.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("output=markdown");
    expect(requestedUrl).not.toContain("token=");
  });
});
