import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("enables only providers with credentials in env mode", () => {
    const config = loadConfig({
      RRCRAWL_AUTH_MODE: "env",
      FIRECRAWL_API_KEY: "fire",
      SCRAPEDO_API_TOKEN: "scrape",
    });

    expect(config.authMode).toBe("env");
    expect(config.providers).toEqual(["firecrawl", "scrapedo"]);
    expect(config.firecrawl.apiKey).toBe("fire");
  });

  it("detects OneCLI and does not expose provider secrets", () => {
    const config = loadConfig({
      RRCRAWL_AUTH_MODE: "auto",
      ONECLI_URL: "http://127.0.0.1:10254",
      FIRECRAWL_API_KEY: "must-not-be-used",
    });

    expect(config.authMode).toBe("onecli");
    expect(config.providers).toEqual(["firecrawl", "tavily", "scrapedo"]);
    expect(config.firecrawl.apiKey).toBeUndefined();
  });

  it("rejects a non-decimal timeout value", () => {
    expect(() =>
      loadConfig({
        RRCRAWL_AUTH_MODE: "env",
        FIRECRAWL_API_KEY: "fire",
        RRCRAWL_REQUEST_TIMEOUT_MS: "0x1F4",
      }),
    ).toThrow("must be a positive integer");
  });

  it("rejects an explicitly enabled provider without its env credential", () => {
    expect(() =>
      loadConfig({
        RRCRAWL_AUTH_MODE: "env",
        RRCRAWL_PROVIDERS: "tavily",
      }),
    ).toThrow("Missing credentials");
  });
});
