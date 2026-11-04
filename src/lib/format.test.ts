import { describe, expect, it } from "vitest";
import { formatPhone, formatWon, isLowBalance } from "./format";

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

describe("formatPhone", () => {
  it.each([
    ["01000000001", "010-0000-0001"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["0311234567", "031-123-4567"],
    ["15881234", "1588-1234"],
    ["123456789012", "123456789012"],
  ])("%s → %s", (digits, expected) => {
    expect(formatPhone(digits)).toBe(expected);
  });
});
