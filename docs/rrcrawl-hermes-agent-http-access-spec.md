# rrcrawl Agent-Oriented MCP Surface Specification

**Status:** Proposed  
**Target repository:** `romanbsd/rrcrawl`  
**Primary integration target:** `NousResearch/hermes-agent`  
**Scope:** MCP server behavior and public tool surface in `rrcrawl`  
**Non-goal:** Patching or forking Hermes to special-case `rrcrawl`

---

## 1. Executive Summary

`rrcrawl` currently provides a small MCP surface centered on provider-backed scraping and crawling. That surface is technically compatible with Hermes Agent, but it is not optimized for how an autonomous agent actually consumes HTTP resources.

The goal of this feature is to make `rrcrawl` a high-quality, agent-facing HTTP research layer with three clear primitives:

- `extract` — read one or more known URLs.
- `research` — discover sources for a question and extract useful evidence.
- `crawl` — traverse a site when information is spread across multiple related pages.

The design deliberately hides provider-specific details from the model. Firecrawl, Tavily, Scrape.do, and future providers remain internal implementation choices. The model should reason in terms of intent, not transport or vendor.

The most important first-phase changes are:

1. Add a **batch `extract` tool** that accepts multiple URLs.
2. Rewrite MCP tool descriptions around **agent intent and tool-selection guidance**.
3. Return **clean Markdown in MCP `content`**, while preserving machine-readable metadata in `structuredContent`.
4. Add **strict output budgets**, including per-page and total response caps.
5. Make **partial failures first-class** rather than failing an entire batch.
6. Preserve backward compatibility with the existing `scrape` tool during migration.

Later phases add relevance-focused extraction, caching, a `research` primitive, and adaptive provider routing.

---

## 2. Motivation

Hermes already has a natural web research pattern:

1. Search for relevant sources.
2. Select a set of URLs.
3. Extract content from several URLs.
4. Compare and synthesize evidence.

A single-URL `scrape` tool makes step 3 unnecessarily expensive for the agent. The model must issue repeated tool calls, manage errors individually, and consume repeated MCP framing overhead.

An agent-oriented HTTP layer should instead optimize for:

- **low tool-selection ambiguity**
- **batch operations**
- **predictable token usage**
- **partial-success semantics**
- **clear provenance**
- **provider abstraction**
- **minimal context pollution**
- **safe retry behavior**
- **simple autonomous decision-making**

The MCP tool surface should therefore describe tasks the agent understands, while provider routing, retries, caching, normalization, and failure handling remain internal to `rrcrawl`.

---

## 3. Design Principles

### 3.1 Agent intent over provider mechanics

Public MCP tools MUST describe the user's or agent's intent.

Good:

```text
extract
research
crawl
```

Avoid exposing:

```text
firecrawl_scrape
tavily_extract
scrapedo_fetch
choose_provider
```

Provider selection is infrastructure and SHOULD remain internal.

### 3.2 Small public tool surface

The preferred long-term MCP surface is exactly:

```text
extract
research
crawl
```

A small surface reduces model tool-selection entropy.

### 3.3 Clean text for the model, structured data for machines

MCP `content` SHOULD be optimized for the LLM.

MCP `structuredContent` SHOULD contain:

- URLs
- titles
- provider names
- cache metadata
- truncation metadata
- failures
- timings where useful

The model SHOULD NOT need to parse JSON embedded inside a text content item.

### 3.4 Bounded outputs by default

Every content-producing operation MUST have deterministic output limits.

The server SHOULD truncate or reduce output before it reaches the MCP client.

### 3.5 Partial success is success

If 4 of 5 URLs are extracted successfully, the operation SHOULD return the four successful pages and one structured failure.

The MCP call SHOULD only be marked `isError: true` if the operation is unusable as a whole.

### 3.6 Hermes-friendly, not Hermes-specific

The tool descriptions and behavior SHOULD work well from Hermes, but `rrcrawl` MUST remain a generic MCP server usable by other agents and MCP clients.

Do not introduce Hermes-specific protocol extensions or hard-coded tool names.

---

## 4. Existing Behavior to Preserve

At the time of this specification, `rrcrawl` exposes:

- `scrape`
- `crawl`

`createServer()` registers these tools via the MCP SDK.

The existing `scrape` tool:

- accepts one URL
- routes across configured scrape providers
- fails over on provider errors
- returns normalized Markdown
- exposes provider provenance

The existing `crawl` tool:

- accepts one root URL
- supports `limit`
- supports `maxDepth`
- supports `includePaths`
- supports `allowExternal`
- supports natural-language `instructions`
- routes between crawl-capable providers

This feature SHOULD preserve existing behavior during migration unless explicitly changed below.

---

# 5. Target Public MCP API

## 5.1 `extract`

### Purpose

Read and extract content from one or more known HTTP/HTTPS URLs.

### Intended agent behavior

Use `extract` when the agent already knows which URLs it wants to inspect.

Examples:

- read search results
- inspect documentation pages
- read release notes
- inspect product pages
- gather evidence from several known sources
- quote or summarize one or more pages

### Proposed description

```text
Read and extract the contents of one or more HTTP/HTTPS URLs.

Use this tool whenever you need to inspect, read, quote, summarize,
or obtain information from known web pages or HTTP resources.

Prefer this over browser automation unless interaction with the page,
live DOM state, authentication flows, or browser-only behavior is required.

Provider selection, retries, normalization, and failover are handled automatically.
```

The description is intentionally about **when to use the tool**, not implementation internals.

### Input schema

```ts
const extractInputSchema = {
  urls: z
    .array(z.string().url())
    .min(1)
    .max(20)
    .describe("HTTP or HTTPS URLs to read"),

  query: z
    .string()
    .max(1_000)
    .optional()
    .describe(
      "Optional description of the information needed from these pages. " +
      "When provided, the server may reduce each page to the most relevant content."
    ),

  mode: z
    .enum(["full", "relevant"])
    .default("full")
    .describe(
      "full returns normalized page content subject to output limits; " +
      "relevant returns content most useful for the query."
    ),

  maxCharsPerPage: z
    .number()
    .int()
    .min(1_000)
    .max(100_000)
    .default(30_000)
    .describe("Maximum text returned for each page"),

  maxTotalChars: z
    .number()
    .int()
    .min(2_000)
    .max(250_000)
    .default(100_000)
    .describe("Maximum text returned across the entire tool call"),

  fresh: z
    .boolean()
    .default(false)
    .describe("Bypass cached content and fetch fresh results"),
};
```

### Validation rules

- `urls` MUST contain at least 1 URL.
- `urls` MUST contain no more than 20 URLs.
- Duplicate URLs SHOULD be canonicalized and deduplicated before fetching.
- Unsupported protocols MUST be rejected.
- Only `http:` and `https:` SHOULD be accepted.
- `mode="relevant"` SHOULD require `query`; if omitted, the server SHOULD either:
  - downgrade to `full`, or
  - return a validation error.

Preferred behavior: validation error, because silent mode changes are harder to reason about.

### Concurrency

The server SHOULD fetch multiple URLs concurrently.

Default internal concurrency:

```text
4
```

Recommended configurable environment variable:

```text
RRCRAWL_EXTRACT_CONCURRENCY=4
```

Range:

```text
1..16
```

Concurrency SHOULD be internal and SHOULD NOT be exposed as an MCP parameter.

### Output schema

```ts
const extractedPageSchema = z.object({
  requestedUrl: z.string().url(),
  url: z.string().url(),
  title: z.string().optional(),
  markdown: z.string(),
  provider: z.string(),
  cached: z.boolean(),
  truncated: z.boolean(),
  originalChars: z.number().int().nonnegative().optional(),
  returnedChars: z.number().int().nonnegative(),
});

const extractFailureSchema = z.object({
  url: z.string().url(),
  error: z.string(),
  code: z.string().optional(),
  attemptedProviders: z.array(z.string()).default([]),
});

const extractOutputSchema = z.object({
  pages: z.array(extractedPageSchema),
  failures: z.array(extractFailureSchema),
});
```

Provider MAY remain an enum internally, but the MCP schema SHOULD use `z.string()` if future providers are expected.

That prevents every provider addition from requiring a public schema change.

---

## 5.2 Text rendering for `extract`

The MCP `content` response MUST be readable Markdown, not serialized JSON.

### Single-page response

```markdown
# Example Page

Source: https://example.com/docs

<normalized markdown content>
```

### Multi-page response

```markdown
# Source 1: Example Page

URL: https://example.com/docs

<markdown>

---

# Source 2: Another Page

URL: https://example.org/article

<markdown>
```

### Failures

Failures SHOULD appear at the end only when present:

```markdown
---

## Fetch failures

- https://example.net/private — HTTP 403
```

Do not include provider routing diagnostics in normal text unless useful to the agent.

### Structured content

Full provenance belongs in `structuredContent`.

Example:

```json
{
  "pages": [
    {
      "requestedUrl": "https://example.com",
      "url": "https://www.example.com/",
      "title": "Example",
      "markdown": "...",
      "provider": "firecrawl",
      "cached": false,
      "truncated": false,
      "returnedChars": 8421
    }
  ],
  "failures": []
}
```

---

# 6. Backward-Compatible `scrape`

The existing `scrape` tool SHOULD remain temporarily.

It should become a thin compatibility wrapper around `extract`.

Equivalent behavior:

```ts
scrape({ url })
```

internally becomes:

```ts
extract({
  urls: [url],
  mode: "full",
});
```

### Compatibility response

Existing callers may expect:

```json
{
  "provider": "...",
  "url": "...",
  "title": "...",
  "markdown": "..."
}
```

Therefore `scrape` SHOULD retain its current `structuredContent` schema during the compatibility period.

### Deprecation

The MCP description SHOULD say:

```text
Compatibility tool for reading one URL. New clients should prefer `extract`,
which supports batching and better output controls.
```

Do not remove `scrape` until at least one published release after `extract` becomes stable.

Recommended sequence:

```text
0.2.x — add extract; scrape remains normal
0.3.x — mark scrape deprecated in description/docs
1.0   — decide whether scrape remains permanently as a convenience alias
```

There is little downside to retaining it indefinitely if maintenance cost is negligible.

---

# 7. `crawl` Improvements

The existing `crawl` primitive is conceptually correct but should be made more agent-oriented.

## 7.1 Proposed description

```text
Discover and read multiple related pages from a website.

Use this when the information you need is spread across a site's
documentation, knowledge base, product pages, or other linked pages.

Do not use this when one or a small known set of URLs is sufficient;
use `extract` instead.

Provider selection, retries, and failover are handled automatically.
```

## 7.2 Input changes

Retain:

- `url`
- `limit`
- `maxDepth`
- `includePaths`
- `allowExternal`
- `instructions`

Add:

```ts
query: z
  .string()
  .max(1_000)
  .optional()
  .describe(
    "Information to prioritize when selecting or reducing crawled pages"
  ),

maxCharsPerPage: z
  .number()
  .int()
  .min(1_000)
  .max(100_000)
  .default(20_000),

maxTotalChars: z
  .number()
  .int()
  .min(2_000)
  .max(300_000)
  .default(120_000),
```

`instructions` and `query` are related but semantically distinct:

- `instructions`: guidance for page discovery
- `query`: guidance for content relevance

Example:

```json
{
  "url": "https://docs.example.com",
  "instructions": "Focus on authentication and deployment documentation",
  "query": "How are API keys configured in self-hosted deployments?"
}
```

## 7.3 Partial failures

A crawl operation SHOULD return successful pages even if some page fetches or provider operations fail.

Suggested schema:

```ts
{
  pages: [...],
  failures: [...],
  provider: "firecrawl"
}
```

The top-level provider may remain if one provider performs the whole crawl.

If routing becomes page-granular later, provider SHOULD move to each page.

---

# 8. New `research` Tool

## 8.1 Purpose

Find relevant public web sources for a question and extract evidence from the best results.

This is a higher-level primitive than `extract`.

Use it when the agent has a question but does not already know which URLs to inspect.

## 8.2 Non-goal

`research` MUST NOT synthesize the final answer.

Hermes or another calling agent remains responsible for:

- comparing sources
- resolving contradictions
- reasoning
- writing the answer
- deciding confidence

`rrcrawl` should return evidence, not conclusions.

## 8.3 Proposed description

```text
Research a question on the public web.

Use this when you need factual information but do not already know
which URLs to inspect. The tool discovers relevant sources, reads the
best results, and returns source-backed evidence.

Use `extract` instead when you already know the URLs.

This tool returns evidence and source content; it does not synthesize
the final answer.
```

## 8.4 Input schema

```ts
const researchInputSchema = {
  query: z
    .string()
    .min(2)
    .max(2_000)
    .describe("Question or topic to research"),

  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of source pages to return"),

  domains: z
    .array(z.string())
    .max(20)
    .default([])
    .describe("Optional domains to prefer or restrict research to"),

  maxCharsPerPage: z
    .number()
    .int()
    .min(1_000)
    .max(50_000)
    .default(20_000),

  maxTotalChars: z
    .number()
    .int()
    .min(2_000)
    .max(150_000)
    .default(75_000),

  fresh: z
    .boolean()
    .default(false),
};
```

## 8.5 Internal pipeline

```text
query
  ↓
search provider(s)
  ↓
normalize results
  ↓
canonicalize URLs
  ↓
deduplicate
  ↓
rank/select top N
  ↓
extract content
  ↓
relevance reduction
  ↓
budget enforcement
  ↓
return evidence
```

## 8.6 Search provider abstraction

Introduce an internal interface:

```ts
export interface SearchProvider {
  readonly name: string;

  search(request: SearchRequest): Promise<SearchResult[]>;
}
```

Suggested types:

```ts
export interface SearchRequest {
  query: string;
  limit: number;
  domains?: string[];
}

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
  score?: number;
}
```

Do not expose provider-specific search payloads to MCP clients.

## 8.7 Output

Suggested structured schema:

```ts
{
  query: string,
  sources: [
    {
      rank: number,
      url: string,
      title?: string,
      snippet?: string,
      markdown: string,
      searchProvider: string,
      extractProvider: string,
      cached: boolean,
      truncated: boolean
    }
  ],
  failures: [...]
}
```

Text content SHOULD render sources sequentially as Markdown.

---

# 9. Relevance Reduction

## 9.1 Goal

Reduce unnecessary page content when the caller provides a `query`.

This helps:

- token usage
- latency
- context quality
- autonomous research depth

## 9.2 First implementation: deterministic

The first implementation SHOULD NOT require another LLM.

Recommended deterministic strategy:

1. Parse normalized Markdown into structural blocks:
   - headings
   - paragraphs
   - lists
   - tables
   - code fences

2. Tokenize the query into normalized terms.

3. Score blocks based on:
   - exact phrase matches
   - query-term density
   - heading matches
   - title matches
   - nearby relevant blocks
   - code/table bonuses where appropriate

4. Select the highest-scoring sections.

5. Preserve heading ancestry.

6. Preserve neighboring blocks to avoid destroying context.

7. Reassemble selected Markdown in original order.

## 9.3 Suggested scoring

Illustrative only:

```text
exact query phrase in heading   +20
query term in heading            +6 each
query term in paragraph          +2 each
title query term                 +5 each
table containing query term      +5
code block containing query term +3
adjacent block relevance         +2
```

Scores SHOULD be implementation details and not exposed.

## 9.4 Relevance fallback

If relevance reduction produces too little useful text:

```text
< 1,000 characters
```

the server SHOULD fall back to a bounded full-text extract.

This avoids empty responses due to poor keyword matching.

## 9.5 Future optional semantic mode

A future release MAY support semantic relevance using embeddings or an LLM, but this is explicitly out of scope for the first implementation.

Do not make external AI inference a required dependency for `extract`.

---

# 10. Output Budgeting

## 10.1 Required limits

Every page-returning operation MUST enforce:

```text
maxCharsPerPage
maxTotalChars
```

The server MUST remain within both.

## 10.2 Default values

Recommended:

### `extract`

```text
maxCharsPerPage = 30,000
maxTotalChars   = 100,000
```

### `crawl`

```text
maxCharsPerPage = 20,000
maxTotalChars   = 120,000
```

### `research`

```text
maxCharsPerPage = 20,000
maxTotalChars   = 75,000
```

## 10.3 Structured truncation

Prefer structural truncation over raw substring slicing.

Order of preference:

1. relevance-selected sections
2. full coherent sections
3. complete paragraphs
4. hard character slicing only as last resort

## 10.4 Metadata

Each page SHOULD report:

```ts
truncated: boolean
originalChars?: number
returnedChars: number
```

If original length is unavailable from a provider, omit `originalChars`.

## 10.5 Total budget allocation

When total page content exceeds `maxTotalChars`, allocate budget fairly.

Recommended algorithm:

1. Give each page a minimum budget:
   ```text
   min(4,000, maxCharsPerPage)
   ```

2. Distribute remaining budget proportionally to original page size.

3. Never exceed `maxCharsPerPage`.

Alternative for `research`: prioritize higher-ranked sources.

For `research`, ranking SHOULD influence allocation:

```text
rank 1 > rank 2 > rank 3 > ...
```

---

# 11. URL Canonicalization and Deduplication

Introduce an internal URL normalization layer before cache lookup or dispatch.

Recommended normalization:

- lowercase hostname
- remove fragment
- remove default ports
- normalize trailing root slash
- preserve meaningful path case
- preserve query string by default
- optionally remove known tracking parameters

Tracking parameters safe to remove:

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
gclid
fbclid
```

Do not remove arbitrary query parameters.

Store:

```ts
requestedUrl
canonicalUrl
finalUrl
```

`finalUrl` is the provider-returned or redirect-resolved URL.

---

# 12. Cache

## 12.1 Motivation

Agents frequently revisit the same sources within a research session.

Caching reduces:

- API cost
- latency
- duplicate provider traffic
- rate-limit pressure

## 12.2 Initial cache design

Use a simple in-process TTL cache first.

Do not introduce Redis or another required service.

Suggested key:

```text
sha256(
  canonicalUrl +
  mode +
  normalizedQuery
)
```

For `mode="full"`, query SHOULD not participate in the key.

## 12.3 Defaults

```text
RRCRAWL_CACHE_TTL_SECONDS=900
RRCRAWL_CACHE_MAX_ENTRIES=500
```

Default TTL:

```text
15 minutes
```

## 12.4 `fresh`

When:

```json
{ "fresh": true }
```

the cache MUST be bypassed for reading.

The fresh result SHOULD replace the existing cached entry.

## 12.5 Cache metadata

Each page SHOULD expose:

```ts
cached: boolean
```

No more cache internals need to be exposed.

## 12.6 Future persistent cache

A future optional cache implementation MAY use:

- SQLite
- filesystem
- Redis
- external cache service

The cache SHOULD be behind an interface from the start:

```ts
interface ContentCache {
  get(key: string): Promise<CachedPage | undefined>;
  set(key: string, value: CachedPage, ttlSeconds: number): Promise<void>;
}
```

---

# 13. Provider Routing

## 13.1 Current state

`RoundRobinRouter` is simple and robust but not ideal for heterogeneous agent workloads.

Different providers can have different strengths:

- ordinary page extraction
- anti-bot handling
- structured extraction
- search
- site crawling
- JavaScript-heavy content
- cost
- latency

## 13.2 Phase 1

Retain round-robin behavior.

The initial agent-facing feature SHOULD NOT be blocked on adaptive routing.

## 13.3 Phase 2: Adaptive router

Introduce:

```ts
export interface RoutingContext {
  operation: "extract" | "crawl" | "research-search";
  url?: string;
  host?: string;
  attempt: number;
}
```

Create:

```ts
interface ProviderRouter {
  scrape(request: ScrapeRequest): Promise<ScrapeResult>;
  crawl(request: CrawlRequest): Promise<CrawlResult>;
  search?(request: SearchRequest): Promise<SearchResult[]>;
}
```

`AdaptiveRouter` can choose providers by policy.

## 13.4 Routing policy

A default policy MAY consider:

- operation type
- provider capability
- recent provider failures
- per-provider latency
- per-host failure history
- optional cost rank

Provider preference SHOULD be deterministic and configurable.

Example:

```text
extract ordinary URL:
  Scrape.do → Firecrawl → Tavily

crawl:
  Firecrawl → Tavily

research search:
  Tavily → future search providers
```

This ordering is an example only and MUST remain configurable.

## 13.5 Failover

A provider error SHOULD cause fallback to the next eligible provider.

Record internally:

```ts
attemptedProviders: string[]
```

Expose it only in structured failures.

---

# 14. Error Semantics

## 14.1 Tool-level error

Use MCP `isError: true` only for failures such as:

- invalid configuration
- malformed input that escaped schema validation
- no configured providers capable of the requested operation
- catastrophic internal error
- all requested URLs fail and no useful result exists
- search cannot run at all for `research`

## 14.2 Partial failure

If at least one useful page is returned:

```text
isError MUST be false
```

Failed URLs go into:

```ts
failures[]
```

## 14.3 Failure schema

```ts
interface FetchFailure {
  url: string;
  error: string;
  code?: string;
  attemptedProviders: string[];
}
```

Potential normalized codes:

```text
TIMEOUT
DNS_ERROR
HTTP_401
HTTP_403
HTTP_404
HTTP_429
HTTP_5XX
PROVIDER_ERROR
UNSUPPORTED_CONTENT
INVALID_URL
UNKNOWN
```

Normalize provider-specific errors where practical.

## 14.4 Error messages

Error text SHOULD be:

- concise
- safe
- free of credentials
- actionable for an autonomous agent

Good:

```text
HTTP 403 from all available extraction providers
```

Avoid:

```text
Firecrawl returned AxiosError {... huge payload ...}
```

---

# 15. MCP Annotations

All three public tools SHOULD declare:

```ts
annotations: {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
}
```

`fresh=true` still qualifies as logically read-only and idempotent with respect to external state.

---

# 16. Suggested Types

Create or expand `src/types.ts`.

```ts
export type ProviderName = string;

export interface ExtractRequest {
  urls: string[];
  query?: string;
  mode: "full" | "relevant";
  maxCharsPerPage: number;
  maxTotalChars: number;
  fresh: boolean;
}

export interface ExtractedPage {
  requestedUrl: string;
  url: string;
  title?: string;
  markdown: string;
  provider: ProviderName;
  cached: boolean;
  truncated: boolean;
  originalChars?: number;
  returnedChars: number;
}

export interface FetchFailure {
  url: string;
  error: string;
  code?: string;
  attemptedProviders: ProviderName[];
}

export interface ExtractResult {
  pages: ExtractedPage[];
  failures: FetchFailure[];
}

export interface SearchRequest {
  query: string;
  limit: number;
  domains?: string[];
}

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
  score?: number;
  provider: ProviderName;
}

export interface ResearchRequest {
  query: string;
  limit: number;
  domains: string[];
  maxCharsPerPage: number;
  maxTotalChars: number;
  fresh: boolean;
}

export interface ResearchSource extends ExtractedPage {
  rank: number;
  snippet?: string;
  searchProvider: ProviderName;
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  failures: FetchFailure[];
}
```

---

# 17. Proposed Internal Modules

Recommended organization:

```text
src/
  cache/
    cache.ts
    memory-cache.ts

  content/
    budget.ts
    canonicalize.ts
    relevance.ts
    render.ts

  providers/
    ...

  research/
    search.ts
    research.ts

  config.ts
  router.ts
  server.ts
  types.ts
```

## Responsibilities

### `content/canonicalize.ts`

- URL normalization
- duplicate detection
- tracking parameter removal

### `content/budget.ts`

- per-page limits
- total limits
- structured truncation
- allocation strategy

### `content/relevance.ts`

- deterministic relevance scoring
- heading-aware selection
- fallback behavior

### `content/render.ts`

- Markdown rendering for MCP `content`
- failure summaries
- no JSON serialization

### `cache/cache.ts`

Cache interface.

### `cache/memory-cache.ts`

Initial TTL/LRU-ish in-process implementation.

### `research/search.ts`

Search-provider abstraction and result normalization.

### `research/research.ts`

Search → dedupe → extract → rank → budget pipeline.

---

# 18. `createServer()` Changes

`server.ts` SHOULD register:

```text
extract
crawl
research
scrape
```

during the compatibility period.

Preferred registration order:

```text
extract
research
crawl
scrape
```

If MCP clients preserve discovery order in any prompt construction, this order puts the preferred tools first.

Each handler SHOULD delegate to service functions rather than embedding logic directly in `registerTool()` callbacks.

Example:

```ts
server.registerTool(
  "extract",
  extractToolDefinition,
  async (input) => {
    try {
      const result = await extractService.extract(input);
      return toMcpExtractResult(result);
    } catch (error) {
      return toErrorResult(error);
    }
  },
);
```

Keep MCP schema/rendering separate from provider orchestration.

---

# 19. Configuration

Add optional configuration entries.

Environment variables:

```text
RRCRAWL_EXTRACT_CONCURRENCY=4
RRCRAWL_CACHE_TTL_SECONDS=900
RRCRAWL_CACHE_MAX_ENTRIES=500
RRCRAWL_RELEVANCE_ENABLED=true
RRCRAWL_MAX_URLS_PER_EXTRACT=20
```

Existing timeout/provider configuration remains authoritative.

## Validation

Config parser SHOULD enforce sane ranges.

Example:

```text
EXTRACT_CONCURRENCY: 1..16
CACHE_TTL_SECONDS: 0..86400
CACHE_MAX_ENTRIES: 0..10000
MAX_URLS_PER_EXTRACT: 1..50
```

`0` cache entries or TTL MAY disable caching.

---

# 20. Hermes Integration Guidance

The implementation MUST remain generic, but documentation SHOULD include a Hermes example.

Example:

```yaml
mcp_servers:
  rrcrawl:
    command: "npx"
    args: ["-y", "rrcrawl@latest"]
    env:
      RRCRAWL_AUTH_MODE: "env"
      FIRECRAWL_API_KEY: "..."
      TAVILY_API_KEY: "..."
      SCRAPEDO_API_TOKEN: "..."
    tools:
      include:
        - extract
        - research
        - crawl
```

Recommended Hermes usage pattern:

```text
Known URL(s)   → extract
Unknown URL(s) → research
Whole site     → crawl
Interactive UI → browser tools
```

Documentation SHOULD explicitly explain this mental model.

---

# 21. Tool-Selection Descriptions

Tool descriptions are part of the agent interface and MUST be treated as product behavior.

They SHOULD:

- explain when to use the tool
- explain when not to use it
- distinguish neighboring tools
- avoid provider details unless necessary
- avoid marketing language
- remain concise

## Final recommended descriptions

### `extract`

```text
Read and extract the contents of one or more HTTP/HTTPS URLs.

Use this when you already know which pages or resources you need to inspect.
It is suitable for reading, quoting, summarizing, comparing, or gathering
evidence from known URLs.

Prefer this over browser automation unless interaction with the page,
live DOM state, authentication, or browser-only behavior is required.

Use `research` instead when you need to discover relevant sources first.
```

### `research`

```text
Research a question on the public web.

Use this when you need factual information but do not already know which
URLs to inspect. The tool discovers relevant sources, reads the best results,
and returns source-backed evidence.

Use `extract` instead when you already know the URLs.

This tool returns evidence; it does not synthesize the final answer.
```

### `crawl`

```text
Discover and read multiple related pages from a website.

Use this when the information you need is spread across a site's
documentation, knowledge base, product pages, or other linked pages.

Use `extract` instead when one or a small known set of URLs is sufficient.
```

### `scrape`

```text
Read one HTTP/HTTPS URL as normalized Markdown.

Compatibility alias for single-page extraction. New clients should prefer
`extract`, which supports batching and output controls.
```

---

# 22. Testing Strategy

Tests MUST cover behavior rather than only provider calls.

## 22.1 Unit tests

### URL canonicalization

Cases:

- fragments removed
- hostname case normalized
- root slash normalized
- UTM parameters removed
- meaningful query parameters retained
- duplicates collapsed

### Budgeting

Cases:

- page below budget unchanged
- page above per-page budget reduced
- multiple pages exceed total budget
- exact total cap respected
- truncation metadata correct
- structural boundaries preferred

### Relevance

Cases:

- heading exact match gets selected
- relevant paragraph preserved
- heading ancestry preserved
- neighboring context included
- fallback to full mode when relevance output is too small
- no query allowed in `relevant` mode produces validation failure

### Cache

Cases:

- first request misses
- second request hits
- expired entry misses
- `fresh=true` bypasses cache
- fresh result replaces cached value
- query participates in relevant-mode cache key
- query does not affect full-mode cache key

## 22.2 Router tests

Cases:

- provider succeeds first attempt
- first provider fails, second succeeds
- all providers fail
- attempted provider list correct
- unsupported operation reports useful error

## 22.3 `extract` integration tests

Cases:

- one URL success
- many URL success
- duplicate URL deduplication
- redirect/final URL
- mixed success/failure
- all fail
- concurrency limit respected
- Markdown content rendering
- structured output correctness
- no JSON blob in `content`

## 22.4 `crawl` tests

Cases:

- existing options preserved
- query-aware reduction
- total output limit
- partial page failures
- external-page restriction remains enforced

## 22.5 `research` tests

Use fake providers.

Cases:

- search returns N results
- duplicate result URLs collapsed
- extraction called for selected URLs
- failed extraction does not fail full research result
- search ranking preserved
- source budgets respect rank
- domains forwarded to provider
- no working search provider yields tool-level error

## 22.6 MCP-level tests

Instantiate `McpServer` using fake router/services.

Verify:

- tools are discoverable
- input schemas match expected shape
- annotations are present
- structuredContent validates
- tool errors use `isError`
- partial failures do not use `isError`

---

# 23. Acceptance Criteria

## Phase 1 acceptance criteria

Feature is considered complete when:

- `extract` accepts 1–20 URLs.
- extraction runs with bounded concurrency.
- duplicate URLs are deduplicated.
- provider routing/failover continues to work.
- successful pages and failures can coexist.
- `content` is human-readable Markdown.
- `structuredContent` contains full metadata.
- per-page and total output caps are enforced.
- `scrape` remains backward compatible.
- `crawl` description clearly distinguishes it from `extract`.
- all behavior is covered by tests.
- README contains generic MCP usage and Hermes example.

## Phase 2 acceptance criteria

- deterministic relevance mode works
- TTL cache works
- cache can be bypassed with `fresh`
- relevant output is query-aware
- truncation is structural where practical

## Phase 3 acceptance criteria

- `research` exists
- at least one search-capable provider is integrated
- search results are deduplicated
- selected sources are extracted and budgeted
- source provenance is preserved
- final answer synthesis remains outside `rrcrawl`

## Phase 4 acceptance criteria

- adaptive provider routing exists
- provider preference is configurable
- failover remains deterministic
- routing decisions are testable

---

# 24. Implementation Phases

## Phase 1 — Hermes-friendly extraction surface

Highest priority.

Implement:

- `extract`
- multi-URL batching
- concurrency limiting
- clean Markdown text response
- structured failures
- output budgets
- rewritten descriptions
- compatibility `scrape`
- tests
- docs

This phase provides most of the immediate Hermes benefit.

## Phase 2 — Context efficiency

Implement:

- relevance mode
- URL canonicalization improvements
- in-memory TTL cache
- structured truncation
- cache metadata

## Phase 3 — Research primitive

Implement:

- `SearchProvider`
- search normalization
- `research`
- source ranking
- evidence extraction
- research-specific budgeting

## Phase 4 — Adaptive routing

Replace or augment `RoundRobinRouter` with routing policies.

Do not delay Phases 1–3 for this.

---

# 25. Explicit Non-Goals

This feature MUST NOT initially attempt to:

- replace a full browser automation stack
- execute arbitrary JavaScript locally
- manage logged-in browser sessions
- solve CAPTCHAs directly
- synthesize research conclusions
- run a second LLM for every extraction
- expose provider selection to the agent
- require Redis
- require a database
- patch Hermes
- mirror every parameter of every underlying provider
- become a generic workflow engine

Keep `rrcrawl` focused on resilient HTTP information access for agents.

---

# 26. Security and Safety

## 26.1 URL restrictions

At minimum, validate protocols.

A future hardened deployment SHOULD optionally support SSRF restrictions.

Potential config:

```text
RRCRAWL_BLOCK_PRIVATE_NETWORKS=true
```

When enabled, block:

- localhost
- loopback ranges
- RFC1918 private ranges
- link-local addresses
- cloud instance metadata IPs

This MUST be configurable because local-network crawling can be a valid use case.

## 26.2 Credentials

Provider credentials MUST:

- remain environment/config-only
- never appear in MCP content
- never appear in structured failures
- be stripped from provider exceptions

## 26.3 Returned content

Fetched content is untrusted data.

`rrcrawl` SHOULD normalize content but MUST NOT claim it is safe or authoritative.

Do not interpret page instructions as MCP instructions.

---

# 27. Observability

Do not expose verbose provider telemetry to the model.

Log internally:

```text
operation
canonical URL
selected provider
attempt count
latency
cache hit/miss
returned character count
truncated
normalized failure code
```

Avoid logging full page bodies by default.

Optional environment variable:

```text
RRCRAWL_LOG_LEVEL=info
```

Suggested levels:

```text
error
warn
info
debug
```

---

# 28. Performance Targets

These are engineering targets, not hard protocol guarantees.

### Cached extraction

```text
p95 < 100 ms
```

excluding MCP process transport overhead.

### Uncached extraction

Dominated by provider latency.

rrcrawl overhead SHOULD remain:

```text
< 50 ms
```

excluding relevance processing on very large pages.

### Relevance reduction

For a 500 KB Markdown document:

```text
target < 50 ms
```

on a modern CPU using deterministic scoring.

### Memory

Cache MUST be bounded.

Avoid holding duplicate full page bodies after budgeting when not needed.

---

# 29. README Documentation Changes

README SHOULD contain a new section:

```text
Agent-oriented tools
```

with this table:

| Tool | Use when |
|---|---|
| `extract` | You already know the URL(s) |
| `research` | You know the question but not the sources |
| `crawl` | Information is spread across one site |
| `scrape` | Compatibility single-URL alias |

Add a Hermes example but present it as one consumer among many.

Also document:

- output limits
- partial failures
- cache behavior
- provider abstraction
- `fresh=true`
- relevance mode

---

# 30. Suggested Phase-1 API Example

Agent call:

```json
{
  "urls": [
    "https://example.com/docs/auth",
    "https://example.com/docs/deploy",
    "https://example.org/blog/release"
  ],
  "query": "How are production API credentials configured?",
  "mode": "relevant"
}
```

MCP text content:

```markdown
# Source 1: Authentication

URL: https://example.com/docs/auth

## API keys

Production API keys are configured using ...

---

# Source 2: Deployment

URL: https://example.com/docs/deploy

## Environment

Set the following environment variables ...

---

## Fetch failures

- https://example.org/blog/release — HTTP 403 from all available extraction providers
```

Structured content:

```json
{
  "pages": [
    {
      "requestedUrl": "https://example.com/docs/auth",
      "url": "https://example.com/docs/auth",
      "title": "Authentication",
      "markdown": "## API keys\n...",
      "provider": "firecrawl",
      "cached": false,
      "truncated": false,
      "originalChars": 18330,
      "returnedChars": 4210
    },
    {
      "requestedUrl": "https://example.com/docs/deploy",
      "url": "https://example.com/docs/deploy",
      "title": "Deployment",
      "markdown": "## Environment\n...",
      "provider": "scrapedo",
      "cached": true,
      "truncated": false,
      "originalChars": 12220,
      "returnedChars": 3011
    }
  ],
  "failures": [
    {
      "url": "https://example.org/blog/release",
      "error": "HTTP 403 from all available extraction providers",
      "code": "HTTP_403",
      "attemptedProviders": [
        "scrapedo",
        "firecrawl",
        "tavily"
      ]
    }
  ]
}
```

---

# 31. Recommended First PR

The first implementation PR SHOULD stay narrow.

### Include

- `extract`
- batch concurrency
- output schemas
- Markdown rendering
- partial failure semantics
- max chars per page
- max total chars
- updated tool descriptions
- `scrape` compatibility wrapper
- tests
- README update

### Exclude

- `research`
- cache
- relevance ranking
- adaptive routing

This creates a small, reviewable foundation.

Suggested PR title:

```text
feat: add agent-oriented batch extract MCP tool
```

Suggested follow-up PRs:

```text
feat: add bounded relevance extraction
feat: add TTL content cache
feat: add research MCP primitive
feat: add adaptive provider routing
```

---

# 32. Definition of Done

The feature is complete when an MCP client such as Hermes can reason about the tool surface using the following simple model:

```text
I know the URLs
    → extract

I know the question, not the URLs
    → research

I need to explore one site
    → crawl

I need to click/interact/render browser state
    → use a browser tool instead
```

At that point, `rrcrawl` is no longer merely a round-robin scraping wrapper. It becomes a compact, predictable, provider-agnostic HTTP evidence layer designed for autonomous agents while remaining generic enough for any MCP-compatible client.
