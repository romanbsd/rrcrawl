export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${responseBody.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

// Signals that a provider has exhausted its quota/credits (as opposed to a
// transient rate limit). The router disables the provider for the rest of the
// process when it sees this.
export class QuotaExceededError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} quota exhausted (HTTP ${status})`);
    this.name = "QuotaExceededError";
  }
}

// Rethrows an error, converting an HttpError with a hard quota/credit status
// into a QuotaExceededError; every other error is rethrown unchanged.
export function rethrowQuota(
  provider: string,
  error: unknown,
  quotaStatuses: readonly number[],
): never {
  if (error instanceof HttpError && quotaStatuses.includes(error.status)) {
    throw new QuotaExceededError(provider, error.status);
  }
  throw error;
}

// True only for an absolute http(s) URL — the shape pageSchema.url() accepts.
// Guards against relative/garbage provider URLs that would otherwise fail
// output validation outside the tool handler as an unrecoverable McpError.
export function isAbsoluteHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Reads the full body under the same timeout/abort as the request so a stalled
// body can't hang forever after the headers arrive.
async function requestBody(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, body, url);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const body = await requestBody(fetchFn, url, init, timeoutMs);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${body.slice(0, 500)}`);
  }
}

export async function requestText(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<string> {
  return requestBody(fetchFn, url, init, timeoutMs);
}
