import { describe, expect, it } from "vitest";
import {
  allocateBudgets,
  truncateMarkdown,
} from "../../src/content/budget.js";

describe("truncateMarkdown", () => {
  it("leaves content below the budget unchanged", () => {
    expect(truncateMarkdown("abc", 10)).toEqual({
      text: "abc",
      truncated: false,
    });
  });

  it("cuts at a paragraph boundary when one sits near the cap", () => {
    expect(truncateMarkdown("aa\n\nbb\n\ncc", 8)).toEqual({
      text: "aa\n\nbb",
      truncated: true,
    });
  });

  it("hard-slices only when no structural boundary is available", () => {
    expect(truncateMarkdown("abcdefghij", 5)).toEqual({
      text: "abcde",
      truncated: true,
    });
  });

  it("marks exactly-capped content as untruncated", () => {
    expect(truncateMarkdown("hello", 5)).toEqual({
      text: "hello",
      truncated: false,
    });
  });
});

describe("allocateBudgets", () => {
  it("returns per-page caps when total fits within budget", () => {
    expect(allocateBudgets([100, 200], 1_000, 500)).toEqual([100, 200]);
  });

  it("caps a single oversized page at maxCharsPerPage", () => {
    expect(allocateBudgets([800], 1_000, 500)).toEqual([500]);
  });

  it("gives each page a fair minimum when total overflows", () => {
    // base = min(4000, floor(2000/3)=666); remainder split equally.
    expect(allocateBudgets([1_000, 1_000, 1_000], 2_000, 5_000)).toEqual([
      666, 666, 666,
    ]);
  });

  it("never exceeds maxCharsPerPage or maxTotalChars", () => {
    const budgets = allocateBudgets([100, 100_000], 5_000, 3_000);
    expect(budgets).toEqual([2_500, 2_500]);
    expect(Math.max(...budgets)).toBeLessThanOrEqual(3_000);
    expect(budgets.reduce((sum, b) => sum + b, 0)).toBeLessThanOrEqual(5_000);
  });

  it("allocates proportionally to size", () => {
    const budgets = allocateBudgets([1_000, 3_000], 2_000, 5_000);
    // base = min(4000, floor(2000/2)=1000); remaining 0 → equal minimum.
    expect(budgets).toEqual([1_000, 1_000]);
  });
});