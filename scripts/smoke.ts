import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { FirecrawlProvider } from "../src/providers/firecrawl.js";
import { ScrapeDoProvider } from "../src/providers/scrapedo.js";
import { TavilyProvider } from "../src/providers/tavily.js";

const SCRAPE_URL = "https://example.com/";
// A site with internal links so crawl actually returns multiple pages;
// example.com has none and yields an empty crawl.
const CRAWL_URL = "https://books.toscrape.com/";

function preview(markdown: string): string {
  const line = markdown.trim().split("\n")[0] ?? "";
  return `${markdown.length} chars | first: ${JSON.stringify(line.slice(0, 60))}`;
}

async function step(label: string, run: () => Promise<string>): Promise<boolean> {
  process.stdout.write(`- ${label} ... `);
  try {
    console.log(`OK  ${await run()}`);
    return true;
  } catch (error) {
    console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`auth mode: ${config.authMode}, providers: ${config.providers.join(", ")}\n`);

  const firecrawl = new FirecrawlProvider({
    ...config.firecrawl,
    requestTimeoutMs: config.requestTimeoutMs,
    crawlTimeoutMs: config.crawlTimeoutMs,
    pollIntervalMs: config.pollIntervalMs,
  });
  const tavily = new TavilyProvider({
    ...config.tavily,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  const scrapedo = new ScrapeDoProvider({
    ...config.scrapedo,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const results: boolean[] = [];

  results.push(
    await step("firecrawl.scrape", async () =>
      preview((await firecrawl.scrape({ url: SCRAPE_URL })).markdown),
    ),
  );
  results.push(
    await step("tavily.scrape", async () =>
      preview((await tavily.scrape({ url: SCRAPE_URL })).markdown),
    ),
  );
  results.push(
    await step("scrapedo.scrape", async () =>
      preview((await scrapedo.scrape({ url: SCRAPE_URL })).markdown),
    ),
  );

  const crawlArgs = {
    limit: 2,
    maxDepth: 1,
    includePaths: [] as string[],
    allowExternal: false,
  };
  results.push(
    await step("firecrawl.crawl", async () => {
      const r = await firecrawl.crawl({ url: CRAWL_URL, ...crawlArgs });
      return `${r.pages.length} page(s) | ${preview(r.pages[0]?.markdown ?? "")}`;
    }),
  );
  results.push(
    await step("tavily.crawl", async () => {
      const r = await tavily.crawl({ url: CRAWL_URL, ...crawlArgs });
      return `${r.pages.length} page(s) | ${preview(r.pages[0]?.markdown ?? "")}`;
    }),
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
