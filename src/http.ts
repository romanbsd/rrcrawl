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
