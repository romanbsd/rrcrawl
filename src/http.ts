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

async function request(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpError(response.status, await response.text(), url);
    }
    return response;
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
  const response = await request(fetchFn, url, init, timeoutMs);
  const body = await response.text();
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
  return (await request(fetchFn, url, init, timeoutMs)).text();
}
