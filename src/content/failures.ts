import { HttpError } from "../http.js";
import {
  AllProvidersFailedError,
  ServiceUnavailableError,
} from "../router.js";
import type { FetchFailure, ProviderName } from "../types.js";

function codeForStatus(status: number): string | undefined {
  if (status === 401) return "HTTP_401";
  if (status === 403) return "HTTP_403";
  if (status === 404) return "HTTP_404";
  if (status === 429) return "HTTP_429";
  if (status >= 500) return "HTTP_5XX";
  return undefined;
}

// Concise, credential-free error text and a normalized code for one failed
// fetch. Provider error messages are truncated to avoid dumping large bodies
// into the model context.
export function normalizeFailure(url: string, error: unknown): FetchFailure {
  if (error instanceof HttpError) {
    return {
      url,
      error: `HTTP ${error.status} from ${url}`,
      code: codeForStatus(error.status),
      attemptedProviders: [],
    };
  }

  if (error instanceof AllProvidersFailedError) {
    const attemptedProviders: ProviderName[] = error.failures.map(
      (failure) => failure.provider,
    );
    const statuses = error.failures
      .map((failure) => failure.status)
      .filter((status): status is number => status !== undefined);
    const unique = [...new Set(statuses)];
    if (unique.length === 1 && codeForStatus(unique[0])) {
      return {
        url,
        error: `HTTP ${unique[0]} from all available extraction providers`,
        code: codeForStatus(unique[0]),
        attemptedProviders,
      };
    }
    const first = error.failures[0];
    return {
      url,
      error: first
        ? `${first.provider}: ${first.message.slice(0, 300)}`
        : error.message.slice(0, 300),
      code: "PROVIDER_ERROR",
      attemptedProviders,
    };
  }

  if (error instanceof ServiceUnavailableError) {
    return {
      url,
      error: error.message,
      code: "PROVIDER_ERROR",
      attemptedProviders: [],
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return { url, error: "Request timed out", code: "TIMEOUT", attemptedProviders: [] };
  }

  return {
    url,
    error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    code: "UNKNOWN",
    attemptedProviders: [],
  };
}