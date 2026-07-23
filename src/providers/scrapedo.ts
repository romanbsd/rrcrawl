import { requestText, toQuotaError, type FetchLike } from "../http.js";
import type {
  ScrapeProvider,
  ScrapeRequest,
  ScrapeResult,
} from "../types.js";

export interface ScrapeDoOptions {
  apiUrl: string;
  apiToken?: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export class ScrapeDoProvider implements ScrapeProvider {
  readonly name = "scrapedo" as const;
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: ScrapeDoOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const endpoint = new URL(this.options.apiUrl);
    endpoint.searchParams.set("url", request.url);
    endpoint.searchParams.set("output", "markdown");
    if (this.options.apiToken) {
      endpoint.searchParams.set("token", this.options.apiToken);
    }

    // 402 Payment Required is the permanent out-of-credits signal; 429
    // (rate/concurrency) is transient and left to normal failover.
    let markdown: string;
    try {
      markdown = await requestText(
        this.fetchFn,
        endpoint.toString(),
        { method: "GET", headers: { accept: "text/markdown, text/plain, */*" } },
        this.options.requestTimeoutMs,
      );
    } catch (error) {
      throw toQuotaError(this.name, error, [402]);
    }
    if (!markdown.trim()) {
      throw new Error("Scrape.do returned no markdown content");
    }
    return {
      provider: this.name,
      url: request.url,
      markdown,
    };
  }
}
