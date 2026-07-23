#!/usr/bin/env node
import "dotenv/config";
import { createRequire } from "node:module";
import { loadConfig } from "./config.js";
import { configureProxy } from "./proxy.js";
import { runServer } from "./server.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const arguments_ = new Set(process.argv.slice(2));
  if (arguments_.has("--version") || arguments_.has("-v")) {
    console.log(version);
    return;
  }
  if (arguments_.has("--help") || arguments_.has("-h")) {
    console.log(`rrcrawl ${version}

Tiny stdio MCP server for round-robin web scraping and crawling.

Usage:
  rrcrawl
  rrcrawl --help
  rrcrawl --version

Configuration is read from environment variables and .env.
See https://www.npmjs.com/package/rrcrawl for details.`);
    return;
  }
  configureProxy();
  await runServer(loadConfig());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
