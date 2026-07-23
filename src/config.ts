import type { ProviderName } from "./types.js";

export type AuthMode = "env" | "onecli";

export interface AppConfig {
  authMode: AuthMode;
  providers: ProviderName[];
  requestTimeoutMs: number;
  crawlTimeoutMs: number;
  pollIntervalMs: number;
  firecrawl: { apiUrl: string; apiKey?: string };
  tavily: { apiUrl: string; apiKey?: string };
  scrapedo: { apiUrl: string; apiToken?: string };
}

type Environment = Record<string, string | undefined>;

const providerNames = new Set<ProviderName>([
  "firecrawl",
  "tavily",
  "scrapedo",
]);

function positiveInteger(
  env: Environment,
  name: string,
  fallback: number,
): number {
  const value = env[name];
  if (!value) return fallback;
  // Plain base-10 digits only: reject hex, exponent, leading +/- and whitespace
  // that Number() would silently accept.
  if (!/^[0-9]+$/.test(value.trim())) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseAuthMode(env: Environment): AuthMode {
  const configured = env.RRCRAWL_AUTH_MODE ?? "auto";
  if (configured === "auto") {
    return env.ONECLI_URL ? "onecli" : "env";
  }
  if (configured !== "env" && configured !== "onecli") {
    throw new Error("RRCRAWL_AUTH_MODE must be auto, env, or onecli");
  }
  return configured;
}

function parseProviderList(value: string): ProviderName[] {
  const result = value
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

  for (const provider of result) {
    if (!providerNames.has(provider as ProviderName)) {
      throw new Error(`Unknown provider in RRCRAWL_PROVIDERS: ${provider}`);
    }
  }
  return [...new Set(result)] as ProviderName[];
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const authMode = parseAuthMode(env);
  const firecrawlKey = env.FIRECRAWL_API_KEY;
  const tavilyKey = env.TAVILY_API_KEY;
  const scrapedoToken =
    env.SCRAPEDO_API_TOKEN ?? env.SCRAPE_DO_API_TOKEN ?? env.SCRAPE_DO_TOKEN;

  const configuredProviders = env.RRCRAWL_PROVIDERS
    ? parseProviderList(env.RRCRAWL_PROVIDERS)
    : undefined;

  let providers: ProviderName[];
  if (configuredProviders) {
    providers = configuredProviders;
  } else if (authMode === "onecli") {
    providers = ["firecrawl", "tavily", "scrapedo"];
  } else {
    providers = [
      ...(firecrawlKey ? (["firecrawl"] as const) : []),
      ...(tavilyKey ? (["tavily"] as const) : []),
      ...(scrapedoToken ? (["scrapedo"] as const) : []),
    ];
  }

  if (providers.length === 0) {
    throw new Error(
      "No providers configured. Set provider API keys or use RRCRAWL_AUTH_MODE=onecli.",
    );
  }

  if (authMode === "env") {
    const missing = providers.filter(
      (provider) =>
        (provider === "firecrawl" && !firecrawlKey) ||
        (provider === "tavily" && !tavilyKey) ||
        (provider === "scrapedo" && !scrapedoToken),
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing credentials for configured providers: ${missing.join(", ")}`,
      );
    }
  }

  return {
    authMode,
    providers,
    requestTimeoutMs: positiveInteger(
      env,
      "RRCRAWL_REQUEST_TIMEOUT_MS",
      60_000,
    ),
    crawlTimeoutMs: positiveInteger(
      env,
      "RRCRAWL_CRAWL_TIMEOUT_MS",
      180_000,
    ),
    pollIntervalMs: positiveInteger(
      env,
      "RRCRAWL_POLL_INTERVAL_MS",
      2_000,
    ),
    firecrawl: {
      apiUrl: (env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev").replace(
        /\/$/,
        "",
      ),
      apiKey: authMode === "env" ? firecrawlKey : undefined,
    },
    tavily: {
      apiUrl: (env.TAVILY_API_URL ?? "https://api.tavily.com").replace(
        /\/$/,
        "",
      ),
      apiKey: authMode === "env" ? tavilyKey : undefined,
    },
    scrapedo: {
      apiUrl: env.SCRAPEDO_API_URL ?? "https://api.scrape.do/",
      apiToken: authMode === "env" ? scrapedoToken : undefined,
    },
  };
}
