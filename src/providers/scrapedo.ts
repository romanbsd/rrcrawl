import {
  HttpError,
  QuotaExceededError,
  requestText,
  type FetchLike,
} from "../http.js";
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

    // Scrape.do returns the *target's* HTTP status. Distinguish its own
    // control-plane errors from the scraped page's status:
    //   402 -> out of credits (permanent quota)
    //   400/401/429 -> Scrape.do rejected the request (transient failover)
    //   everything else (403/404/410/5xx) is the target page's own status;
    //   Scrape.do still returns its rendered content, so use it.
    let markdown: string;
    try {
      markdown = await requestText(
        this.fetchFn,
        endpoint.toString(),
        { method: "GET", headers: { accept: "text/markdown, text/plain, */*" } },
        this.options.requestTimeoutMs,
      );
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 402) {
          throw new QuotaExceededError(this.name, 402);
        }
        if (error.status === 400 || error.status === 401 || error.status === 429) {
          throw error;
        }
        markdown = error.responseBody;
      } else {
        throw error;
      }
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
