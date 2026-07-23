import type {
  CrawlProvider,
  CrawlRequest,
  CrawlResult,
  ProviderName,
  ScrapeProvider,
  ScrapeRequest,
  ScrapeResult,
} from "./types.js";

export class AllProvidersFailedError extends Error {
  constructor(
    readonly operation: "scrape" | "crawl",
    readonly failures: Array<{ provider: ProviderName; message: string }>,
  ) {
    super(
      `All ${operation} providers failed: ${failures
        .map(({ provider, message }) => `${provider}: ${message}`)
        .join("; ")}`,
    );
    this.name = "AllProvidersFailedError";
  }
}

export class RoundRobinRouter {
  private scrapeCursor = 0;
  private crawlCursor = 0;

  constructor(
    private readonly scrapeProviders: ScrapeProvider[],
    private readonly crawlProviders: CrawlProvider[],
  ) {
    if (scrapeProviders.length === 0) {
      throw new Error("At least one scrape provider is required");
    }
  }

  scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const start = this.scrapeCursor;
    this.scrapeCursor = (this.scrapeCursor + 1) % this.scrapeProviders.length;
    return this.tryProviders(
      "scrape",
      this.scrapeProviders,
      start,
      (provider) => provider.scrape(request),
    );
  }

  crawl(request: CrawlRequest): Promise<CrawlResult> {
    if (this.crawlProviders.length === 0) {
      throw new Error(
        "No crawl-capable provider configured; enable Firecrawl or Tavily",
      );
    }
    const start = this.crawlCursor;
    this.crawlCursor = (this.crawlCursor + 1) % this.crawlProviders.length;
    return this.tryProviders(
      "crawl",
      this.crawlProviders,
      start,
      (provider) => provider.crawl(request),
    );
  }

  private async tryProviders<TProvider extends { name: ProviderName }, TResult>(
    operation: "scrape" | "crawl",
    providers: TProvider[],
    start: number,
    execute: (provider: TProvider) => Promise<TResult>,
  ): Promise<TResult> {
    const failures: Array<{ provider: ProviderName; message: string }> = [];

    for (let offset = 0; offset < providers.length; offset += 1) {
      const provider = providers[(start + offset) % providers.length];
      try {
        return await execute(provider);
      } catch (error) {
        failures.push({
          provider: provider.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new AllProvidersFailedError(operation, failures);
  }
}
