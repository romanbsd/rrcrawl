import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, RoundRobinRouter } from "../src/router.js";
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
