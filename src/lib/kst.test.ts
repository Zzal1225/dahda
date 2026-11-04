import { describe, expect, it } from "vitest";
import { formatKstDateTime, formatKstTime, periodToRange } from "./kst";

describe("KST 표시", () => {
  it("UTC를 KST로 바꿔 표시한다", () => {
    expect(formatKstDateTime("2026-11-04T05:30:00Z")).toBe("2026.11.04 14:30");
    expect(formatKstTime("2026-11-04T05:30:05Z")).toBe("14:30:05");
  });

  it("UTC 저녁은 KST 다음 날이다", () => {
    expect(formatKstDateTime("2026-11-04T15:00:00Z")).toBe("2026.11.05 00:00");
  });

  it("자정을 24시가 아니라 00시로 표시한다", () => {
    expect(formatKstTime("2026-11-04T15:00:00Z")).toBe("00:00:00");
  });
});

describe("periodToRange", () => {
  // KST 2026-11-04 10:00
  const now = new Date("2026-11-04T01:00:00Z");

  it("오늘은 KST 0시부터다", () => {
    expect(periodToRange("today", null, null, now)).toEqual({
      from: "2026-11-03T15:00:00.000Z",
      to: null,
    });
  });

  it("7일은 오늘을 포함한다", () => {
    expect(periodToRange("7d", null, null, now).from).toBe(
      "2026-10-28T15:00:00.000Z",
    );
  });

  it("30일은 오늘을 포함한다", () => {
    expect(periodToRange("30d", null, null, now).from).toBe(
      "2026-10-05T15:00:00.000Z",
    );
  });

  it("UTC로는 전날이어도 KST 날짜를 기준으로 한다", () => {
    // KST 2026-11-05 00:30, UTC로는 11-04
    const justAfterKstMidnight = new Date("2026-11-04T15:30:00Z");
    expect(periodToRange("today", null, null, justAfterKstMidnight).from).toBe(
      "2026-11-04T15:00:00.000Z",
    );
  });

  it("직접 지정은 끝 날짜의 하루 전체를 포함한다", () => {
    expect(periodToRange("custom", "2026-11-01", "2026-11-04", now)).toEqual({
      from: "2026-10-31T15:00:00.000Z",
      to: "2026-11-04T15:00:00.000Z",
    });
  });

  it.each(["abc", "2026-13-40", "2026-11-1"])(
    "잘못된 날짜 %s는 조건 없음으로 처리한다",
    (day) => {
      expect(periodToRange("custom", day, day, now)).toEqual({
        from: null,
        to: null,
      });
    },
  );
});
