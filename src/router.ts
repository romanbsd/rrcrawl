import { QuotaExceededError } from "./http.js";
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

// No provider is available to serve the request: every configured provider has
// been permanently disabled after exhausting its quota.
export class ServiceUnavailableError extends Error {
  constructor(readonly operation: "scrape" | "crawl") {
    super(
      `Service unavailable: all ${operation} providers have exhausted their quota`,
    );
    this.name = "ServiceUnavailableError";
  }
}

export class RoundRobinRouter {
  private readonly cursor: Record<"scrape" | "crawl", number> = {
    scrape: 0,
    crawl: 0,
  };
  // Providers that hit a hard quota. Account-level: disabling here removes the
  // provider from both scrape and crawl rotations until the process restarts.
  private readonly disabled = new Set<ProviderName>();

  constructor(
    private readonly scrapeProviders: ScrapeProvider[],
    private readonly crawlProviders: CrawlProvider[],
  ) {
    if (scrapeProviders.length === 0) {
      throw new Error("At least one scrape provider is required");
    }
  }

  scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    return this.tryProviders("scrape", this.scrapeProviders, (provider) =>
      provider.scrape(request),
    );
  }

  crawl(request: CrawlRequest): Promise<CrawlResult> {
    if (this.crawlProviders.length === 0) {
      throw new Error(
        "No crawl-capable provider configured; enable Firecrawl or Tavily",
      );
    }
    return this.tryProviders("crawl", this.crawlProviders, (provider) =>
      provider.crawl(request),
    );
  }

  private async tryProviders<TProvider extends { name: ProviderName }, TResult>(
    operation: "scrape" | "crawl",
    providers: TProvider[],
    execute: (provider: TProvider) => Promise<TResult>,
  ): Promise<TResult> {
    const active = providers.filter(
      (provider) => !this.disabled.has(provider.name),
    );
    if (active.length === 0) {
      throw new ServiceUnavailableError(operation);
    }

    const start = this.cursor[operation] % active.length;
    this.cursor[operation] += 1;
    const failures: Array<{ provider: ProviderName; message: string }> = [];

    for (let offset = 0; offset < active.length; offset += 1) {
      const provider = active[(start + offset) % active.length];
      try {
        return await execute(provider);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          this.disabled.add(provider.name);
        }
        failures.push({
          provider: provider.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If the quota errors just disabled the last provider, surface unavailable
    // rather than a generic all-failed error.
    if (providers.every((provider) => this.disabled.has(provider.name))) {
      throw new ServiceUnavailableError(operation);
    }
    throw new AllProvidersFailedError(operation, failures);
  }
}
