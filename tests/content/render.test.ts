import { describe, expect, it } from "vitest";
import { renderExtractResult } from "../../src/content/render.js";
import type { ExtractResult } from "../../src/types.js";

function page(url: string, markdown: string, title?: string) {
  return {
    requestedUrl: url,
    url,
    ...(title ? { title } : {}),
    markdown,
    provider: "firecrawl" as const,
    cached: false,
    truncated: false,
    originalChars: markdown.length,
    returnedChars: markdown.length,
  };
}

describe("renderExtractResult", () => {
  it("renders a single page with a Source line", () => {
    const result: ExtractResult = {
      pages: [page("https://example.com/docs", "# Body", "Docs")],
      failures: [],
    };
    expect(renderExtractResult(result)).toBe(
      "# Docs\n\nSource: https://example.com/docs\n\n# Body",
    );
  });

  it("renders multiple pages numbered and separated", () => {
    const result: ExtractResult = {
      pages: [
        page("https://example.com/1", "# M1", "One"),
        page("https://example.com/2", "# M2", "Two"),
      ],
      failures: [],
    };
    expect(renderExtractResult(result)).toBe(
      "# Source 1: One\n\nSource: https://example.com/1\n\n# M1\n\n---\n\n" +
        "# Source 2: Two\n\nSource: https://example.com/2\n\n# M2",
    );
  });

  it("appends a fetch-failures section when present", () => {
    const result: ExtractResult = {
      pages: [page("https://example.com/ok", "# Body")],
      failures: [
        {
          url: "https://example.com/bad",
          error: "HTTP 403 from all available extraction providers",
          code: "HTTP_403",
          attemptedProviders: ["firecrawl"],
        },
      ],
    };
    const rendered = renderExtractResult(result);
    expect(rendered).toContain(
      "## Fetch failures\n\n- https://example.com/bad — HTTP 403 from all available extraction providers",
    );
  });

  it("renders only the failures section when every page failed", () => {
    const result: ExtractResult = {
      pages: [],
      failures: [
        { url: "https://example.com/x", error: "down", attemptedProviders: [] },
      ],
    };
    expect(renderExtractResult(result)).toBe(
      "## Fetch failures\n\n- https://example.com/x — down",
    );
  });

  it("never embeds JSON in the text content", () => {
    const result: ExtractResult = {
      pages: [
        page("https://example.com/a", 'plain text with "quotes" and : colons'),
      ],
      failures: [],
    };
    expect(renderExtractResult(result)).not.toContain('"provider"');
  });
});