import { describe, expect, it } from "vitest";
import { proxyUrl } from "../src/proxy.js";

describe("proxyUrl", () => {
  it("prefers HTTPS_PROXY over HTTP_PROXY", () => {
    expect(
      proxyUrl({
        HTTPS_PROXY: "http://gateway:8080",
        HTTP_PROXY: "http://other:3128",
      }),
    ).toBe("http://gateway:8080");
  });

  it("falls back to lowercase and to HTTP_PROXY", () => {
    expect(proxyUrl({ https_proxy: "http://lower:8080" })).toBe(
      "http://lower:8080",
    );
    expect(proxyUrl({ HTTP_PROXY: "http://plain:3128" })).toBe(
      "http://plain:3128",
    );
  });

  it("returns undefined when no proxy is set", () => {
    expect(proxyUrl({})).toBeUndefined();
  });
});
