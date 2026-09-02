export interface TruncationResult {
  text: string;
  truncated: boolean;
}

// Cuts Markdown at a structural boundary (paragraph, else line) near the cap
// rather than raw character slicing, so the result doesn't end mid-sentence.
// Hard slicing is only the last resort. Falls back to a hard slice when no
// boundary sits past 70% of the budget (a boundary far below the cap would
// waste most of the allowed budget).
export function truncateMarkdown(markdown: string, maxChars: number): TruncationResult {
  if (markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }
  const window = markdown.slice(0, maxChars);
  const paragraph = window.lastIndexOf("\n\n");
  const line = window.lastIndexOf("\n");
  const boundary = paragraph > maxChars * 0.7 ? paragraph : line;
  const cutAt = boundary > maxChars * 0.7 ? boundary : maxChars;
  return { text: markdown.slice(0, cutAt), truncated: true };
}

// Allocates a per-page character budget when total content exceeds
// `maxTotalChars`. Each page gets a minimum of min(4000, maxCharsPerPage),
// and the remainder is distributed proportionally to original size. Budgets
// never exceed maxCharsPerPage and always sum to <= maxTotalChars.
export function allocateBudgets(
  sizes: number[],
  maxTotalChars: number,
  maxCharsPerPage: number,
): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= maxTotalChars) {
    return sizes.map((size) => Math.min(size, maxCharsPerPage));
  }
  const n = sizes.length;
  const base = Math.min(
    Math.min(4_000, maxCharsPerPage),
    Math.floor(maxTotalChars / n),
  );
  const remaining = maxTotalChars - n * base;
  const weightSum = sizes.reduce((sum, size) => sum + size, 0) || 1;
  return sizes.map((size) =>
    Math.min(base + Math.floor((remaining * size) / weightSum), maxCharsPerPage),
  );
}