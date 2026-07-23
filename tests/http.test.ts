import { afterEach, describe, expect, it, vi } from "vitest";
import { type FetchLike, requestJson, requestText } from "../src/http.js";

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
