import { describe, expect, it } from "vitest";
import {
  formatKstDateTime,
  formatKstMonthDayWeekday,
  formatKstTime,
  kstBuckets,
  kstDayOptions,
  kstDayTimeToUtc,
  kstHour,
  kstTimeOptions,
  periodToRange,
} from "./kst";

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

describe("formatKstMonthDayWeekday", () => {
  it("KST 날짜와 요일을 쓴다", () => {
    // UTC 11-06 16:00 = KST 11-07 01:00 (토)
    expect(formatKstMonthDayWeekday("2026-11-06T16:00:00Z")).toBe(
      "11월 7일(토)",
    );
    expect(formatKstMonthDayWeekday("2026-11-06T04:00:00Z")).toBe(
      "11월 6일(금)",
    );
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

describe("kstHour", () => {
  it.each([
    ["2026-11-04T12:00:00Z", 21],
    ["2026-11-04T15:00:00Z", 0],
    ["2026-11-04T23:00:00Z", 8],
  ])("%s → %d", (iso, hour) => {
    expect(kstHour(new Date(iso))).toBe(hour);
  });
});

describe("kstDayTimeToUtc", () => {
  it("KST를 UTC로 바꾼다", () => {
    expect(kstDayTimeToUtc("2026-11-05", "08:00")?.toISOString()).toBe(
      "2026-11-04T23:00:00.000Z",
    );
  });

  it.each([
    ["", "10:00"],
    ["2026-11-04", ""],
    ["2026-13-01", "10:00"],
    ["2026-02-31", "10:00"],
    ["2026-11-04", "24:00"],
    ["2026-11-04", "10:60"],
    ["abc", "def"],
  ])("잘못된 값 %j %j는 null이다", (day, time) => {
    expect(kstDayTimeToUtc(day, time)).toBeNull();
  });
});

describe("kstDayOptions", () => {
  it("KST 오늘부터 요일과 함께 만든다", () => {
    // KST 2026-11-05 00:30, UTC로는 11-04
    const options = kstDayOptions(new Date("2026-11-04T15:30:00Z"), 2);
    expect(options).toEqual([
      { value: "2026-11-05", label: "2026.11.05 (목)" },
      { value: "2026-11-06", label: "2026.11.06 (금)" },
    ]);
  });
});

describe("kstTimeOptions", () => {
  it("30분 단위 48개다", () => {
    const options = kstTimeOptions();
    expect(options).toHaveLength(48);
    expect(options[0]).toBe("00:00");
    expect(options[1]).toBe("00:30");
    expect(options[47]).toBe("23:30");
  });
});

describe("kstBuckets", () => {
  it("일별은 오늘을 포함한 칸이고 시작은 첫날 KST 0시다", () => {
    // UTC 11-12 15:30 = KST 11-13 00:30. 서버(UTC)로는 아직 12일이다.
    const result = kstBuckets("day", 3, new Date("2026-11-12T15:30:00Z"));
    expect(result.keys).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(result.start).toBe("2026-11-10T15:00:00.000Z");
  });

  it("KST 자정 직전은 아직 그날이다", () => {
    const result = kstBuckets("day", 1, new Date("2026-11-13T14:59:59Z"));
    expect(result.keys).toEqual(["2026-11-13"]);
  });

  it("월말을 넘어 날짜를 센다", () => {
    expect(kstBuckets("day", 3, new Date("2026-03-01T03:00:00Z")).keys).toEqual(
      ["2026-02-27", "2026-02-28", "2026-03-01"],
    );
  });

  it("월별은 1일을 키로 하고 해를 넘어 센다", () => {
    const result = kstBuckets("month", 3, new Date("2026-01-20T00:00:00Z"));
    expect(result.keys).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
    expect(result.start).toBe("2025-10-31T15:00:00.000Z");
  });

  it("월 첫날 KST 0시 직후는 그 달이다", () => {
    // UTC 10-31 15:00 = KST 11-01 00:00
    expect(
      kstBuckets("month", 1, new Date("2026-10-31T15:00:00Z")).keys,
    ).toEqual(["2026-11-01"]);
  });
});
