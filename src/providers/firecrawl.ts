import {
  isAbsoluteHttpUrl,
  requestJson,
  rethrowQuota,
  type FetchLike,
} from "../http.js";
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
  next?: string | null;
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
    const url = this.documentUrl(response.data);
    const page = this.page(
      response.data,
      isAbsoluteHttpUrl(url) ? url : request.url,
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

    const statusUrl = `${this.options.apiUrl}/v2/crawl/${encodeURIComponent(started.id)}`;
    const deadline = Date.now() + this.options.crawlTimeoutMs;
    const poll = (): Promise<FirecrawlStatusResponse> =>
      this.json<FirecrawlStatusResponse>(statusUrl, {
        method: "GET",
        headers: this.headers(),
      });

    for (;;) {
      const status = await poll();
      if (status.status === "completed") {
        return {
          provider: this.name,
          pages: await this.completedPages(status, request.limit),
        };
      }
      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(
          `Firecrawl crawl ${status.status}: ${status.error ?? "unknown error"}`,
        );
      }
      if (Date.now() >= deadline) {
        break;
      }
      await this.sleep(this.options.pollIntervalMs);
    }

    throw new Error(
      `Firecrawl crawl timed out after ${this.options.crawlTimeoutMs}ms`,
    );
  }

  private async completedPages(
    first: FirecrawlStatusResponse,
    limit: number,
  ): Promise<Page[]> {
    const pages: Page[] = [];
    let batch = first;

    // Firecrawl paginates large results through `next`. Continue until enough
    // usable pages have been collected, rather than counting malformed entries
    // against the caller's page limit.
    // Each crawl page must carry its own absolute URL. If Firecrawl omits it we
    // drop the page rather than mislabel every one with the crawl root.
    for (let i = 0; i <= limit; i += 1) {
      for (const document of batch.data ?? []) {
        const url = this.documentUrl(document);
        if (document.markdown && isAbsoluteHttpUrl(url)) {
          pages.push(this.page(document, url));
          if (pages.length === limit) {
            return pages;
          }
        }
      }

      if (!batch.next || i === limit) {
        break;
      }
      batch = await this.json<FirecrawlStatusResponse>(batch.next, {
        method: "GET",
        headers: this.headers(),
      });
    }

    if (pages.length === 0) {
      throw new Error("Firecrawl crawl completed without page content");
    }
    return pages;
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
      rethrowQuota(this.name, error, [402]);
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
