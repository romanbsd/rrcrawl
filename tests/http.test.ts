import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  QuotaExceededError,
  rethrowQuota,
  type FetchLike,
  requestJson,
  requestText,
} from "../src/http.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("requestBody timeout", () => {
  it("aborts when the response body stalls past the timeout", async () => {
    vi.useFakeTimers();
    // Headers arrive immediately but text() only settles when the signal fires.
    const fetchFn: FetchLike = async (_url, init) => {
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      } as unknown as Response;
    };

    const promise = requestText(fetchFn, "https://example.com", {}, 1000);
    const assertion = expect(promise).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("reads the body under the request timeout for JSON", async () => {
    const fetchFn = vi.fn<FetchLike>(
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      requestJson<{ ok: boolean }>(fetchFn, "https://example.com", {}, 1000),
    ).resolves.toEqual({ ok: true });
  });
});

describe("requestBody HTTP errors", () => {
  it("throws an HttpError carrying status and body for non-ok responses", async () => {
    const fetchFn: FetchLike = async () =>
      new Response("oops", { status: 500 });
    await expect(
      requestText(fetchFn, "https://example.com", {}, 1000),
    ).rejects.toMatchObject({ status: 500, responseBody: "oops" });
  });

  it("reports invalid JSON from an ok response", async () => {
    const fetchFn: FetchLike = async () =>
      new Response("not json", { status: 200 });
    await expect(
      requestJson(fetchFn, "https://example.com", {}, 1000),
    ).rejects.toThrow("Invalid JSON");
  });
});

describe("rethrowQuota", () => {
  it("converts an HttpError with a quota status", () => {
    expect(() =>
      rethrowQuota(
        "firecrawl",
        new HttpError(402, "no credits", "https://api.firecrawl.dev"),
        [402],
      ),
    ).toThrow(QuotaExceededError);
  });

  it("rethrows an HttpError with a non-quota status unchanged", () => {
    const error = new HttpError(429, "slow down", "https://api.firecrawl.dev");
    expect(() => rethrowQuota("firecrawl", error, [402])).toThrow(error);
  });

  it("rethrows a non-HttpError unchanged", () => {
    const error = new Error("boom");
    expect(() => rethrowQuota("firecrawl", error, [402])).toThrow(error);
  });
});
