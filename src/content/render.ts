import type { ExtractResult } from "../types.js";

// Renders an extract result as readable Markdown for the model. Never embeds
// JSON: full provenance lives in structuredContent.
export function renderExtractResult(result: ExtractResult): string {
  const blocks = result.pages.map((page, index) => {
    const heading =
      result.pages.length === 1
        ? `# ${page.title ?? page.url}`
        : `# Source ${index + 1}: ${page.title ?? page.url}`;
    return `${heading}\n\nSource: ${page.url}\n\n${page.markdown}`;
  });

  const parts: string[] = [blocks.join("\n\n---\n\n")];
  if (result.failures.length > 0) {
    const lines = result.failures
      .map((failure) => `- ${failure.url} — ${failure.error}`)
      .join("\n");
    parts.push(`## Fetch failures\n\n${lines}`);
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}