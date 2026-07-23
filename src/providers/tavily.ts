import { requestJson, type FetchLike } from "../http.js";
import type {
  CrawlProvider,
  CrawlRequest,
  CrawlResult,
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
      url: result.url || request.url,
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
    const pages = (response.results ?? [])
      .filter((result) => result.raw_content)
      .map((result) => ({
        url: result.url,
        markdown: result.raw_content ?? "",
      }));
    if (pages.length === 0) {
      throw new Error("Tavily crawl returned no page content");
    }
    return { provider: this.name, pages };
  }

  private post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return requestJson<T>(
      this.fetchFn,
      `${this.options.apiUrl}${path}`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      this.options.requestTimeoutMs,
    );
  }
}
