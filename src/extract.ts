import { allocateBudgets, truncateMarkdown } from "./content/budget.js";
import { dedupeUrls } from "./content/canonicalize.js";
import { normalizeFailure } from "./content/failures.js";
import type { RoundRobinRouter } from "./router.js";
import type {
  ExtractRequest,
  ExtractResult,
  ExtractedPage,
  FetchFailure,
  ScrapeResult,
} from "./types.js";

// Applies an async mapper to items with at most `concurrency` in flight.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

interface ExtractAttempt {
  requestedUrl: string;
  page?: ScrapeResult;
  failure?: FetchFailure;
}

export class ExtractService {
  constructor(
    private readonly router: RoundRobinRouter,
    private readonly concurrency: number,
  ) {}

  async extract(request: ExtractRequest): Promise<ExtractResult> {
    if (request.mode === "relevant") {
      // Relevance extraction is a later phase; reject rather than silently
      // downgrade to full mode (spec §5.1 prefers explicit validation errors).
      throw new Error(
        "mode='relevant' is not available yet; use mode='full'",
      );
    }

    const urls = dedupeUrls(request.urls);
    const attempts = await mapWithConcurrency<{ requestedUrl: string }, ExtractAttempt>(
      urls.map((requestedUrl) => ({ requestedUrl })),
      this.concurrency,
      async (attempt) => {
        try {
          const page = await this.router.scrape({ url: attempt.requestedUrl });
          return { ...attempt, page };
        } catch (error) {
          return {
            ...attempt,
            failure: normalizeFailure(attempt.requestedUrl, error),
          };
        }
      },
    );

    const failures = attempts
      .filter((attempt) => attempt.failure !== undefined)
      .map((attempt) => attempt.failure as FetchFailure);
    const pages = await this.budgetPages(
      attempts
        .filter((attempt) => attempt.page !== undefined)
        .map((attempt) => ({
          requestedUrl: attempt.requestedUrl,
          page: attempt.page as ScrapeResult,
        })),
      request.maxCharsPerPage,
      request.maxTotalChars,
    );

    return { pages, failures };
  }

  private async budgetPages(
    fetched: Array<{ requestedUrl: string; page: ScrapeResult }>,
    maxCharsPerPage: number,
    maxTotalChars: number,
  ): Promise<ExtractedPage[]> {
    const sizes = fetched.map(({ page }) => page.markdown.length);
    const budgets = allocateBudgets(sizes, maxTotalChars, maxCharsPerPage);
    return fetched.map(({ requestedUrl, page }, index) => {
      const { text, truncated } = truncateMarkdown(page.markdown, budgets[index]);
      return {
        requestedUrl,
        url: page.url,
        ...(page.title ? { title: page.title } : {}),
        markdown: text,
        provider: page.provider,
        cached: false,
        truncated,
        originalChars: page.markdown.length,
        returnedChars: text.length,
      };
    });
  }
}