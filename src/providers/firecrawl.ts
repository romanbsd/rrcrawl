import { requestJson, toQuotaError, type FetchLike } from "../http.js";
import type {
  CrawlProvider,
  CrawlRequest,
  CrawlResult,
  Page,
  ScrapeProvider,
  ScrapeRequest,
  ScrapeResult,
} from "../types.js";

interface FirecrawlDocument {
  markdown?: string;
  metadata?: {
    sourceURL?: string;
    sourceUrl?: string;
    url?: string;
    title?: string;
  };
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  error?: string;
  data?: FirecrawlDocument;
}

interface FirecrawlStartResponse {
  success?: boolean;
  error?: string;
  id?: string;
}

interface FirecrawlStatusResponse {
  status?: string;
  data?: FirecrawlDocument[];
  error?: string;
}

export interface FirecrawlOptions {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
  crawlTimeoutMs: number;
  pollIntervalMs: number;
  fetchFn?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class FirecrawlProvider implements ScrapeProvider, CrawlProvider {
  readonly name = "firecrawl" as const;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: FirecrawlOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }

  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const response = await this.json<FirecrawlScrapeResponse>(
      `${this.options.apiUrl}/v2/scrape`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          url: request.url,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      },
    );

    if (response.success === false) {
      throw new Error(
        `Firecrawl scrape failed: ${response.error ?? "unknown error"}`,
      );
    }
    if (!response.data?.markdown) {
      throw new Error("Firecrawl returned no markdown content");
    }
    const page = this.page(
      response.data,
      this.documentUrl(response.data) ?? request.url,
    );
    return { provider: this.name, ...page };
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    const started = await this.json<FirecrawlStartResponse>(
      `${this.options.apiUrl}/v2/crawl`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          url: request.url,
          limit: request.limit,
          maxDiscoveryDepth: request.maxDepth,
          includePaths:
            request.includePaths.length > 0 ? request.includePaths : undefined,
          allowExternalLinks: request.allowExternal,
          prompt: request.instructions,
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
        }),
      },
    );

    if (started.success === false) {
      throw new Error(
        `Firecrawl crawl failed to start: ${started.error ?? "unknown error"}`,
      );
    }
    if (!started.id) {
      throw new Error("Firecrawl did not return a crawl job id");
    }

    const deadline = Date.now() + this.options.crawlTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.json<FirecrawlStatusResponse>(
        `${this.options.apiUrl}/v2/crawl/${encodeURIComponent(started.id)}`,
        { method: "GET", headers: this.headers() },
      );

      if (status.status === "completed") {
        // Each crawl page must carry its own URL. If Firecrawl omits it we drop
        // the page rather than mislabel every one with the crawl root.
        const pages = (status.data ?? [])
          .map((document): Page | undefined => {
            const url = this.documentUrl(document);
            return document.markdown && url
              ? this.page(document, url)
              : undefined;
          })
          .filter((page): page is Page => page !== undefined);
        if (pages.length === 0) {
          throw new Error("Firecrawl crawl completed without page content");
        }
        return { provider: this.name, pages };
      }
      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(
          `Firecrawl crawl ${status.status}: ${status.error ?? "unknown error"}`,
        );
      }
      await this.sleep(this.options.pollIntervalMs);
    }

    throw new Error(
      `Firecrawl crawl timed out after ${this.options.crawlTimeoutMs}ms`,
    );
  }

  // 402 Payment Required is Firecrawl's insufficient-credits signal (permanent).
  // 429 rate limits are transient and deliberately left to normal failover.
  private async json<T>(url: string, init: RequestInit): Promise<T> {
    try {
      return await requestJson<T>(
        this.fetchFn,
        url,
        init,
        this.options.requestTimeoutMs,
      );
    } catch (error) {
      throw toQuotaError(this.name, error, [402]);
    }
  }

  private documentUrl(document: FirecrawlDocument): string | undefined {
    return (
      document.metadata?.sourceURL ??
      document.metadata?.sourceUrl ??
      document.metadata?.url ??
      undefined
    );
  }

  private page(document: FirecrawlDocument, url: string): Page {
    return {
      url,
      ...(document.metadata?.title
        ? { title: document.metadata.title }
        : {}),
      markdown: document.markdown ?? "",
    };
  }
}
