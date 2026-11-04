import { describe, expect, it } from "vitest";
import { formatWon, isLowBalance } from "./format";

describe("formatWon", () => {
  it.each([
    [0, "₩0"],
    [999, "₩999"],
    [1000, "₩1,000"],
    [1234567, "₩1,234,567"],
    [-1500, "-₩1,500"],
  ])("%d → %s", (amount, expected) => {
    expect(formatWon(amount)).toBe(expected);
  });
});

describe("isLowBalance", () => {
  it.each([
    [999_999, true],
    [1_000_000, false],
    [0, true],
  ])("%d → %s", (amount, expected) => {
    expect(isLowBalance(amount)).toBe(expected);
  });
});
