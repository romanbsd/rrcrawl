import { describe, expect, it, vi } from "vitest";
import { ExtractService } from "../src/extract.js";
import { HttpError } from "../src/http.js";
import { RoundRobinRouter } from "../src/router.js";
import type { ScrapeProvider } from "../src/types.js";

function service(
  implementation: ScrapeProvider["scrape"],
  concurrency = 4,
): ExtractService {
  const router = new RoundRobinRouter(
    [{ name: "firecrawl", scrape: implementation }],
    [],
  );
  return new ExtractService(router, concurrency);
}

const request = {
  query: undefined,
  mode: "full" as const,
  maxCharsPerPage: 30_000,
  maxTotalChars: 100_000,
  fresh: false,
};

describe("ExtractService", () => {
  it("extracts one URL with full metadata", async () => {
    const scrape = vi.fn(async ({ url }: { url: string }) => ({
      provider: "firecrawl" as const,
      url,
      title: "T",
      markdown: "# Hello",
    }));
    const result = await service(scrape).extract({
      urls: ["https://example.com/page"],
      ...request,
    });

    expect(result).toEqual({
      pages: [
        {
          requestedUrl: "https://example.com/page",
          url: "https://example.com/page",
          title: "T",
          markdown: "# Hello",
          provider: "firecrawl",
          cached: false,
          truncated: false,
          originalChars: 7,
          returnedChars: 7,
        },
      ],
      failures: [],
    });
  });

  it("deduplicates URLs by canonical form before fetching", async () => {
    const scrape = vi.fn(async ({ url }: { url: string }) => ({
      provider: "firecrawl" as const,
      url,
      markdown: "# x",
    }));
    const result = await service(scrape).extract({
      urls: [
        "https://example.com/a?utm_source=x",
        "https://example.com/a",
        "https://EXAMPLE.com/a#frag",
      ],
      ...request,
    });

    expect(scrape).toHaveBeenCalledTimes(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].requestedUrl).toBe("https://example.com/a");
  });

  it("keeps successful pages alongside structured failures", async () => {
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
    const result = await service(scrape).extract({
      urls: ["https://example.com/good", "https://example.com/bad"],
      ...request,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.failures).toEqual([
      {
        url: "https://example.com/bad",
        error: "firecrawl: boom",
        code: "PROVIDER_ERROR",
        attemptedProviders: ["firecrawl"],
      },
    ]);
  });

  it("returns empty pages with failures when every URL fails", async () => {
    const scrape = vi.fn(async () => {
      throw new Error("down");
    });
    const result = await service(scrape).extract({
      urls: ["https://example.com/1", "https://example.com/2"],
      ...request,
    });

    expect(result.pages).toEqual([]);
    expect(result.failures).toHaveLength(2);
  });

  it("normalizes uniform HTTP errors into a concise failure", async () => {
    const scrape = vi.fn(async () => {
      throw new HttpError(403, "forbidden", "https://api.firecrawl.dev");
    });
    const result = await service(scrape).extract({
      urls: ["https://example.com/private"],
      ...request,
    });

    expect(result.failures[0]).toMatchObject({
      url: "https://example.com/private",
      error: "HTTP 403 from all available extraction providers",
      code: "HTTP_403",
      attemptedProviders: ["firecrawl"],
    });
  });

  it("rejects relevant mode until it is implemented", async () => {
    const scrape = vi.fn();
    await expect(
      service(scrape).extract({
        urls: ["https://example.com"],
        query: "credentials",
        mode: "relevant",
        maxCharsPerPage: 30_000,
        maxTotalChars: 100_000,
        fresh: false,
      }),
    ).rejects.toThrow(/relevant/);
    expect(scrape).not.toHaveBeenCalled();
  });

  it("caps total output across pages", async () => {
    const markdown = "x".repeat(2_000);
    const scrape = vi.fn(async () => ({
      provider: "firecrawl" as const,
      url: "https://example.com",
      markdown,
    }));
    const result = await service(scrape).extract({
      urls: ["https://example.com/1", "https://example.com/2", "https://example.com/3"],
      ...request,
      maxCharsPerPage: 30_000,
      maxTotalChars: 4_000,
    });

    expect(result.pages).toHaveLength(3);
    const total = result.pages.reduce((sum, page) => sum + page.returnedChars, 0);
    expect(total).toBeLessThanOrEqual(4_000);
    expect(result.pages.every((page) => page.truncated)).toBe(true);
  });

  it("caps per-page output at maxCharsPerPage", async () => {
    const markdown = "x".repeat(10_000);
    const scrape = vi.fn(async () => ({
      provider: "firecrawl" as const,
      url: "https://example.com",
      markdown,
    }));
    const result = await service(scrape).extract({
      urls: ["https://example.com"],
      ...request,
      maxCharsPerPage: 5_000,
      maxTotalChars: 100_000,
    });

    expect(result.pages[0].returnedChars).toBe(5_000);
    expect(result.pages[0].truncated).toBe(true);
    expect(result.pages[0].originalChars).toBe(10_000);
  });

  it("respects the configured concurrency limit", async () => {
    const urls = Array.from(
      { length: 8 },
      (_, index) => `https://example.com/${index}`,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const scrape = vi.fn(async ({ url }: { url: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { provider: "firecrawl" as const, url, markdown: "# x" };
    });

    const result = await service(scrape, 2).extract({
      urls,
      ...request,
    });

    expect(maxInFlight).toBe(2);
    expect(result.pages).toHaveLength(8);
  });
});