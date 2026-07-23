export type ProviderName = "firecrawl" | "tavily" | "scrapedo";

export interface Page {
  url: string;
  title?: string;
  markdown: string;
}

export interface ScrapeRequest {
  url: string;
}

export interface ScrapeResult extends Page {
  provider: ProviderName;
}

export interface CrawlRequest {
  url: string;
  limit: number;
  maxDepth: number;
  includePaths: string[];
  allowExternal: boolean;
  instructions?: string;
}

export interface CrawlResult {
  provider: ProviderName;
  pages: Page[];
}

export interface ScrapeProvider {
  readonly name: ProviderName;
  scrape(request: ScrapeRequest): Promise<ScrapeResult>;
}

export interface CrawlProvider {
  readonly name: ProviderName;
  crawl(request: CrawlRequest): Promise<CrawlResult>;
}
