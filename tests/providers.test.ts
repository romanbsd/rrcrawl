import { describe, expect, it, vi } from "vitest";
import { QuotaExceededError, type FetchLike } from "../src/http.js";
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

  it("surfaces a Firecrawl success:false error", async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({ success: false, error: "quota exceeded" }),
    );
    const provider = new FirecrawlProvider({
      apiUrl: "https://firecrawl.test",
      requestTimeoutMs: 1000,
      crawlTimeoutMs: 1000,
      pollIntervalMs: 1,
      fetchFn,
    });

    await expect(provider.scrape({ url: "https://example.com" })).rejects.toThrow(
      "quota exceeded",
    );
  });

  it("maps a 402 to a QuotaExceededError but leaves 429 transient", async () => {
    const make = (status: number) =>
      new FirecrawlProvider({
        apiUrl: "https://firecrawl.test",
        requestTimeoutMs: 1000,
        crawlTimeoutMs: 1000,
        pollIntervalMs: 1,
        fetchFn: vi.fn<FetchLike>(
          async () =>
            new Response(
              JSON.stringify({ success: false, error: "no credits" }),
              { status },
            ),
        ),
      });

    await expect(
      make(402).scrape({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(
      make(429).scrape({ url: "https://example.com" }),
    ).rejects.not.toBeInstanceOf(QuotaExceededError);
  });

  it("drops Firecrawl crawl pages that carry no resolvable URL", async () => {
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
            { markdown: "# Orphan", metadata: {} },
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

    const result = await provider.crawl({
      url: "https://example.com",
      limit: 5,
      maxDepth: 2,
      includePaths: [],
      allowExternal: false,
    });
    expect(result.pages).toEqual([
      { url: "https://example.com/one", markdown: "# One" },
    ]);
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

  it("drops Tavily crawl pages without an absolute URL", async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        results: [
          { url: "https://example.com/keep", raw_content: "# Keep" },
          { url: "", raw_content: "# Empty" },
          { url: "/relative", raw_content: "# Relative" },
        ],
      }),
    );
    const provider = new TavilyProvider({
      apiUrl: "https://tavily.test",
      requestTimeoutMs: 1000,
      fetchFn,
    });

    const result = await provider.crawl({
      url: "https://example.com",
      limit: 5,
      maxDepth: 1,
      includePaths: [],
      allowExternal: false,
    });
    expect(result.pages).toEqual([
      { url: "https://example.com/keep", markdown: "# Keep" },
    ]);
  });

  it("follows Firecrawl crawl pagination via next", async () => {
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "completed",
          next: "https://firecrawl.test/v2/crawl/job-1?skip=1",
          data: [
            {
              markdown: "# One",
              metadata: { sourceURL: "https://example.com/one" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "completed",
          next: null,
          data: [
            {
              markdown: "# Two",
              metadata: { sourceURL: "https://example.com/two" },
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

    const result = await provider.crawl({
      url: "https://example.com",
      limit: 5,
      maxDepth: 1,
      includePaths: [],
      allowExternal: false,
    });
    expect(result.pages).toEqual([
      { url: "https://example.com/one", markdown: "# One" },
      { url: "https://example.com/two", markdown: "# Two" },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
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

  it("returns the scraped body when Scrape.do relays a target 404", async () => {
    const fetchFn = vi.fn<FetchLike>(
      async () => new Response("# Not Found Page", { status: 404 }),
    );
    const provider = new ScrapeDoProvider({
      apiUrl: "https://api.scrape.do/",
      apiToken: "t",
      requestTimeoutMs: 1000,
      fetchFn,
    });

    await expect(
      provider.scrape({ url: "https://example.com/missing" }),
    ).resolves.toMatchObject({ markdown: "# Not Found Page" });
  });

  it("maps a Scrape.do 402 to quota and fails over on 429", async () => {
    const make = (status: number) =>
      new ScrapeDoProvider({
        apiUrl: "https://api.scrape.do/",
        apiToken: "t",
        requestTimeoutMs: 1000,
        fetchFn: vi.fn<FetchLike>(
          async () => new Response("blocked", { status }),
        ),
      });

    await expect(
      make(402).scrape({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(
      make(429).scrape({ url: "https://example.com" }),
    ).rejects.not.toBeInstanceOf(QuotaExceededError);
  });
});
