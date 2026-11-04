import { describe, expect, it } from "vitest";
import { isNightKst, nextAdSendableAt } from "./ad-hours";

describe("nextAdSendableAt", () => {
  it.each([
    ["밤 22시면 다음 날 8시", "2026-11-04T13:00:00Z", "2026-11-04T23:00:00Z"],
    [
      "밤 21시 정각이면 다음 날 8시",
      "2026-11-04T12:00:00Z",
      "2026-11-04T23:00:00Z",
    ],
    ["새벽 3시면 그날 8시", "2026-11-04T18:00:00Z", "2026-11-04T23:00:00Z"],
    ["7시 59분이면 곧 올 8시", "2026-11-04T22:59:00Z", "2026-11-04T23:00:00Z"],
  ])("%s", (_, now, expected) => {
    expect(nextAdSendableAt(new Date(now)).toISOString()).toBe(
      new Date(expected).toISOString(),
    );
  });

  it("돌려준 시각은 야간이 아니다", () => {
    const at = nextAdSendableAt(new Date("2026-11-04T13:00:00Z"));
    expect(isNightKst(at)).toBe(false);
  });
});
