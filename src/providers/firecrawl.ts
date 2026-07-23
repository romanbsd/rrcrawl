import { requestJson, type FetchLike } from "../http.js";
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
  data?: FirecrawlDocument;
}

interface FirecrawlStartResponse {
  success?: boolean;
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
    const response = await requestJson<FirecrawlScrapeResponse>(
      this.fetchFn,
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
      this.options.requestTimeoutMs,
    );

    if (!response.data?.markdown) {
      throw new Error("Firecrawl returned no markdown content");
    }
    const page = this.page(response.data, request.url);
    return { provider: this.name, ...page };
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    const started = await requestJson<FirecrawlStartResponse>(
      this.fetchFn,
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
      this.options.requestTimeoutMs,
    );

    if (!started.id) {
      throw new Error("Firecrawl did not return a crawl job id");
    }

    const deadline = Date.now() + this.options.crawlTimeoutMs;
    while (Date.now() < deadline) {
      const status = await requestJson<FirecrawlStatusResponse>(
        this.fetchFn,
        `${this.options.apiUrl}/v2/crawl/${encodeURIComponent(started.id)}`,
        { method: "GET", headers: this.headers() },
        this.options.requestTimeoutMs,
      );

      if (status.status === "completed") {
        const pages = (status.data ?? [])
          .filter((document) => document.markdown)
          .map((document) => this.page(document, request.url));
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

  private page(document: FirecrawlDocument, fallbackUrl: string): Page {
    return {
      url:
        document.metadata?.sourceURL ??
        document.metadata?.sourceUrl ??
        document.metadata?.url ??
        fallbackUrl,
      ...(document.metadata?.title
        ? { title: document.metadata.title }
        : {}),
      markdown: document.markdown ?? "",
    };
  }
}
