# rrcrawl

A tiny stdio MCP server that gives agents two web-content tools:

- `scrape`: fetch one URL as Markdown, round-robin across Firecrawl, Tavily,
  and Scrape.do.
- `crawl`: crawl multiple pages as Markdown, round-robin across Firecrawl and
  Tavily. Scrape.do is intentionally excluded because it has no native
  multi-page crawl API.

Each call advances its tool's round-robin cursor. If the selected provider
fails, rrcrawl tries every other provider in that tool's pool once.

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

### `scrape`

```json
{ "url": "https://example.com/article" }
```

Returns the selected provider, canonical URL when available, optional title,
and Markdown.

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
