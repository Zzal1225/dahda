import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, retryDelayMs } from "./retry";

describe("retryDelayMs", () => {
  it.each([
    [1, 60_000],
    [2, 300_000],
    [3, 1_800_000],
  ])("%i번째 시도 뒤에는 %ims 기다린다", (attempt, delay) => {
    expect(retryDelayMs(attempt)).toBe(delay);
  });

  it("재시도 3회를 쓰면 더 시도하지 않는다", () => {
    expect(MAX_ATTEMPTS).toBe(4);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(MAX_ATTEMPTS + 1)).toBeNull();
  });
});
