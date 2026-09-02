import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  dedupeUrls,
} from "../../src/content/canonicalize.js";

describe("canonicalizeUrl", () => {
  it("removes fragments", () => {
    expect(canonicalizeUrl("https://example.com/a#section")).toBe(
      "https://example.com/a",
    );
  });

  it("lowercases the hostname but preserves path case", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/Path/Page")).toBe(
      "https://example.com/Path/Page",
    );
  });

  it("removes default ports", () => {
    expect(canonicalizeUrl("https://example.com:443/a")).toBe(
      "https://example.com/a",
    );
    expect(canonicalizeUrl("http://example.com:80/a")).toBe(
      "http://example.com/a",
    );
  });

  it("normalizes the root slash", () => {
    expect(canonicalizeUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(canonicalizeUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/a?utm_source=x&id=5&fbclid=zz&utm_campaign=summer",
      ),
    ).toBe("https://example.com/a?id=5");
  });

  it("keeps non-tracking query parameters intact", () => {
    expect(canonicalizeUrl("https://example.com/search?q=hello")).toBe(
      "https://example.com/search?q=hello",
    );
  });
});

describe("dedupeUrls", () => {
  it("collapses duplicates by canonical form preserving order", () => {
    expect(
      dedupeUrls([
        "https://example.com/a?utm_source=1",
        "https://example.com/b",
        "https://example.com/a",
        "https://EXAMPLE.com/a#frag",
      ]),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("keeps distinct URLs", () => {
    expect(dedupeUrls(["https://example.com/a", "https://example.com/b"])).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});