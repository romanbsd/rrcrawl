# rrcrawl

A tiny stdio MCP server that gives agents three web-content tools:

- `extract`: read one or more known URLs as Markdown, round-robin across
  Firecrawl, Tavily, and Scrape.do with automatic failover.
- `research`: *coming in a later release* — discover sources for a question.
- `crawl`: crawl multiple pages as Markdown, round-robin across Firecrawl and
  Tavily. Scrape.do is intentionally excluded because it has no native
  multi-page crawl API.
- `scrape`: backward-compatible single-URL alias for `extract`.

Tool selection is by intent, not provider: provider routing, retries,
normalization, and failover are internal to rrcrawl.

## Agent-oriented tools

| Tool | Use when |
|---|---|
| `extract` | You already know the URL(s) |
| `research` | You know the question but not the sources (later release) |
| `crawl` | Information is spread across one site |
| `scrape` | Compatibility single-URL alias |

This mental model is what the MCP tool descriptions encode:

```text
Known URL(s)   → extract
Unknown URL(s) → research
Whole site     → crawl
Interactive UI → browser tools
```

`extract` is the primary primitive: it reads one to twenty URLs, fetches them
concurrently (default 4, `RRCRAWL_EXTRACT_CONCURRENCY` 1–16), and returns
human-readable Markdown in `content` plus full provenance in `structuredContent`.

### Output limits

Every `extract` call enforces two deterministic caps:

- `maxCharsPerPage` (default 30,000) — per-page text limit.
- `maxTotalChars` (default 100,000) — total across all pages.

When the total overflows, each page gets a fair minimum and the remainder is
allocated proportionally to page size. Truncation prefers paragraph boundaries
over raw character slicing, and each page reports `truncated`,
`originalChars`, and `returnedChars`.

### Partial failures

`extract` does not fail a batch because one URL failed. Successful pages are
returned alongside a `failures` array carrying the URL, a concise error, a
normalized code (`HTTP_403`, `HTTP_429`, `TIMEOUT`, ...), and the providers
attempted. `isError` is only set when no page at all is usable.

### Provider abstraction

Firecrawl, Tavily, and Scrape.do are internal. The model reasons about
intent (`extract` / `crawl`), never about vendors. Adding or reordering
providers does not change the public MCP surface.

### Compatibility and upcoming features

- `scrape` remains available as a compatibility alias and delegates to
  `extract`. It is not deprecated, but new clients should prefer `extract`.
- `mode: "relevant"`, `query`, and `fresh` are accepted by the schema but
  inactive until relevance extraction and caching ship in later releases.

### Example: Hermes Agent (one consumer among many)

`rrcrawl` is a generic MCP server; any MCP-compatible client can use it.
Hermes Agent configuration looks like:

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
        - crawl
        - scrape
```

## Requirements

- Node.js 22 or newer
- At least one provider credential, or a OneCLI gateway configuration

## Run with npx

Once the package is published, no local installation is needed:

```bash
npx -y rrcrawl@latest
```

An MCP client configuration can launch it directly:

```json
{
  "mcpServers": {
    "rrcrawl": {
      "command": "npx",
      "args": ["-y", "rrcrawl@latest"],
      "env": {
        "FIRECRAWL_API_KEY": "fc-...",
        "TAVILY_API_KEY": "tvly-...",
        "SCRAPEDO_API_TOKEN": "..."
      }
    }
  }
}
```

With OneCLI:

```bash
RRCRAWL_AUTH_MODE=onecli onecli run -- npx -y rrcrawl@latest
```

## Local development

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` for local configuration. `.env` is loaded
automatically and is ignored by Git.

## Authentication modes

`RRCRAWL_AUTH_MODE` accepts:

- `env`: read `FIRECRAWL_API_KEY`, `TAVILY_API_KEY`, and
  `SCRAPEDO_API_TOKEN`.
- `onecli`: omit provider credentials from requests and rely on OneCLI's
  transparent gateway to inject them.
- `auto` (default): use `onecli` when `ONECLI_URL` is present; otherwise use
  `env`.

`RRCRAWL_PROVIDERS` optionally restricts the active providers:

```dotenv
RRCRAWL_PROVIDERS=firecrawl,tavily,scrapedo
```

In `env` mode, providers without credentials are disabled unless explicitly
listed, in which case startup fails with a useful configuration error.

### OneCLI

Configure OneCLI secrets for the provider API hosts:

- `api.firecrawl.dev`: inject `Authorization: Bearer {secret}` for `/v2/*`.
- `api.tavily.com`: inject `Authorization: Bearer {secret}` for `/extract` and
  `/crawl`.
- `api.scrape.do`: inject the `token` query parameter for `/*`.

Then run the built server through the gateway:

```bash
RRCRAWL_AUTH_MODE=onecli onecli run -- node dist/index.js
```

No placeholder provider keys are required: rrcrawl omits the credential fields
in OneCLI mode.

When `HTTPS_PROXY` or `HTTP_PROXY` is set (as OneCLI's gateway does), rrcrawl
installs a matching proxy dispatcher on startup so all provider calls route
through the gateway. Node's global `fetch` does not honor these variables on
its own, so this is required behind an egress-locked gateway. `NODE_EXTRA_CA_CERTS`
(also injected by the gateway) is honored automatically for the gateway's CA.

## Local MCP client configuration

After `npm run build`, configure an MCP client with:

```json
{
  "mcpServers": {
    "rrcrawl": {
      "command": "node",
      "args": ["/absolute/path/to/rrcrawl/dist/index.js"],
      "env": {
        "RRCRAWL_AUTH_MODE": "env",
        "FIRECRAWL_API_KEY": "fc-...",
        "TAVILY_API_KEY": "tvly-...",
        "SCRAPEDO_API_TOKEN": "..."
      }
    }
  }
}
```

For `.env` configuration, set the MCP server's working directory to this
project or pass the variables explicitly.

## Tool schemas

### `extract`

```json
{
  "urls": ["https://example.com/docs/auth", "https://example.com/docs/deploy"],
  "maxCharsPerPage": 30000,
  "maxTotalChars": 100000
}
```

`urls` accepts 1–20 URLs; duplicates are canonicalized and deduplicated
before fetching. Returns readable Markdown in `content` and pages with
`requestedUrl`, `url`, `title`, `provider`, `cached`, `truncated`,
`originalChars`, and `returnedChars` in `structuredContent`.

### `scrape`

```json
{ "url": "https://example.com/article" }
```

Compatibility alias for single-page extraction. Returns the selected provider,
URL, optional title, and Markdown — same shape as before `extract` existed.

### `crawl`

```json
{
  "url": "https://example.com/docs",
  "limit": 10,
  "maxDepth": 1,
  "includePaths": ["/docs/.*"],
  "allowExternal": false,
  "instructions": "Return API reference pages"
}
```

`limit` is capped at 100 and `maxDepth` at 5 to bound cost and response size.

## Development

```bash
npm test
npm run check
npm run build
```

Tests use injected HTTP fakes and never call paid provider APIs.

## Publishing

The package name `rrcrawl` was unclaimed on npm when this project was created.
Availability is only guaranteed after the first successful publish.

```bash
npm login
npm publish
```

`prepublishOnly` runs tests and type-checking, while `prepack` always rebuilds
the distributable executable.
