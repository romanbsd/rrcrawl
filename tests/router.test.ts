import { describe, expect, it, vi } from "vitest";
import { QuotaExceededError } from "../src/http.js";
import {
  AllProvidersFailedError,
  RoundRobinRouter,
  ServiceUnavailableError,
} from "../src/router.js";
import type {
  CrawlProvider,
  ScrapeProvider,
} from "../src/types.js";

function scraper(
  name: ScrapeProvider["name"],
  implementation?: ScrapeProvider["scrape"],
): ScrapeProvider {
  return {
    name,
    scrape:
      implementation ??
      vi.fn(async ({ url }) => ({ provider: name, url, markdown: name })),
  };
}

describe("RoundRobinRouter", () => {
  it("rotates the starting scrape provider", async () => {
    const router = new RoundRobinRouter(
      [scraper("firecrawl"), scraper("tavily"), scraper("scrapedo")],
      [],
    );

    await expect(router.scrape({ url: "https://example.com/1" })).resolves.toMatchObject({
      provider: "firecrawl",
    });
    await expect(router.scrape({ url: "https://example.com/2" })).resolves.toMatchObject({
      provider: "tavily",
    });
    await expect(router.scrape({ url: "https://example.com/3" })).resolves.toMatchObject({
      provider: "scrapedo",
    });
  });

  it("fails over without changing the next round-robin start", async () => {
    const firecrawl = scraper(
      "firecrawl",
      vi.fn(async () => {
        throw new Error("rate limited");
      }),
    );
    const tavily = scraper("tavily");
    const router = new RoundRobinRouter([firecrawl, tavily], []);

    await expect(router.scrape({ url: "https://example.com/1" })).resolves.toMatchObject({
      provider: "tavily",
    });
    await expect(router.scrape({ url: "https://example.com/2" })).resolves.toMatchObject({
      provider: "tavily",
    });
    expect(firecrawl.scrape).toHaveBeenCalledTimes(1);
  });

  it("reports every provider failure", async () => {
    const failed = (name: ScrapeProvider["name"]) =>
      scraper(
        name,
        vi.fn(async () => {
          throw new Error(`${name} down`);
        }),
      );
    const router = new RoundRobinRouter(
      [failed("firecrawl"), failed("tavily")],
      [],
    );

    await expect(
      router.scrape({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("disables a provider after a quota error and skips it thereafter", async () => {
    const firecrawl = scraper(
      "firecrawl",
      vi.fn(async () => {
        throw new QuotaExceededError("firecrawl", 402);
      }),
    );
    const tavily = scraper("tavily");
    const router = new RoundRobinRouter([firecrawl, tavily], []);

    // First call starts on firecrawl (quota) then fails over to tavily.
    await expect(
      router.scrape({ url: "https://example.com/1" }),
    ).resolves.toMatchObject({ provider: "tavily" });
    // Second call would round-robin to firecrawl, but it is now disabled.
    await expect(
      router.scrape({ url: "https://example.com/2" }),
    ).resolves.toMatchObject({ provider: "tavily" });

    expect(firecrawl.scrape).toHaveBeenCalledTimes(1);
  });

  it("does NOT disable a provider on a transient (non-quota) failure", async () => {
    const firecrawl = scraper(
      "firecrawl",
      vi.fn(async () => {
        throw new Error("rate limited");
      }),
    );
    const tavily = scraper("tavily");
    const router = new RoundRobinRouter([firecrawl, tavily], []);

    await router.scrape({ url: "https://example.com/1" }); // starts firecrawl -> tavily
    await router.scrape({ url: "https://example.com/2" }); // starts tavily
    await router.scrape({ url: "https://example.com/3" }); // rotates back to firecrawl
    // Still tried again on call 3: a transient failure does not disable it.
    expect(firecrawl.scrape).toHaveBeenCalledTimes(2);
  });

  it("returns service unavailable once every provider is quota-disabled", async () => {
    const quota = (name: ScrapeProvider["name"]) =>
      scraper(
        name,
        vi.fn(async () => {
          throw new QuotaExceededError(name, 402);
        }),
      );
    const router = new RoundRobinRouter([quota("firecrawl"), quota("tavily")], []);

    // First call exhausts both providers' quota.
    await expect(
      router.scrape({ url: "https://example.com/1" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    // Subsequent calls short-circuit to service unavailable.
    await expect(
      router.scrape({ url: "https://example.com/2" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("uses only crawl-capable providers for crawl", async () => {
    const crawl: CrawlProvider = {
      name: "tavily",
      crawl: vi.fn(async () => ({
        provider: "tavily" as const,
        pages: [{ url: "https://example.com", markdown: "ok" }],
      })),
    };
    const router = new RoundRobinRouter([scraper("scrapedo")], [crawl]);

    await expect(
      router.crawl({
        url: "https://example.com",
        limit: 10,
        maxDepth: 1,
        includePaths: [],
        allowExternal: false,
      }),
    ).resolves.toMatchObject({ provider: "tavily" });
  });
});
