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

interface TavilyResult {
  url: string;
  raw_content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export interface TavilyOptions {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export class TavilyProvider implements ScrapeProvider, CrawlProvider {
  readonly name = "tavily" as const;
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: TavilyOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      accept: "application/json",
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }

  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const response = await this.post<TavilyResponse>("/extract", {
      urls: [request.url],
      format: "markdown",
      extract_depth: "basic",
    });
    const result = response.results?.[0];
    if (!result?.raw_content) {
      throw new Error("Tavily returned no markdown content");
    }
    return {
      provider: this.name,
      url: isAbsoluteHttpUrl(result.url) ? result.url : request.url,
      markdown: result.raw_content,
    };
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    const response = await this.post<TavilyResponse>("/crawl", {
      url: request.url,
      max_depth: request.maxDepth,
      limit: request.limit,
      select_paths:
        request.includePaths.length > 0 ? request.includePaths : undefined,
      allow_external: request.allowExternal,
      instructions: request.instructions,
      format: "markdown",
      extract_depth: "basic",
    });
    // Each crawl page must carry its own absolute URL; drop malformed ones
    // rather than emit a relative URL (crashes output validation) or duplicate
    // the crawl root across pages.
    const pages = (response.results ?? [])
      .map((result): Page | undefined =>
        result.raw_content && isAbsoluteHttpUrl(result.url)
          ? { url: result.url, markdown: result.raw_content }
          : undefined,
      )
      .filter((page): page is Page => page !== undefined);
    if (pages.length === 0) {
      throw new Error("Tavily crawl returned no page content");
    }
    return { provider: this.name, pages };
  }

  // 432 (plan usage exceeded) and 433 (out of credits), plus 402, are Tavily's
  // permanent quota signals. 429 is a transient rate limit, left to failover.
  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await requestJson<T>(
        this.fetchFn,
        `${this.options.apiUrl}${path}`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
        },
        this.options.requestTimeoutMs,
      );
    } catch (error) {
      rethrowQuota(this.name, error, [402, 432, 433]);
    }
  }
}
