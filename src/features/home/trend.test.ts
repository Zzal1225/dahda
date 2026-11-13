import { describe, expect, it } from "vitest";
import {
  axisNumber,
  fillTrend,
  niceTicks,
  trendTotals,
  type TrendRow,
} from "./trend";

const row = (bucket: string, patch: Partial<TrendRow> = {}): TrendRow => ({
  bucket,
  campaign_count: 1,
  recipient_count: 100,
  delivered: 90,
  pending: 5,
  failed: 5,
  ...patch,
});

describe("fillTrend", () => {
  const keys = ["2026-11-11", "2026-11-12", "2026-11-13"];

  it("보낸 적 없는 날도 0인 칸으로 남긴다", () => {
    const points = fillTrend([row("2026-11-12")], keys, "day");
    expect(points.map((point) => point.recipients)).toEqual([0, 100, 0]);
    expect(points[0]).toMatchObject({ delivered: 0, pending: 0, failed: 0 });
  });

  it("키 범위 밖의 행은 버린다", () => {
    const points = fillTrend(
      [row("2026-11-01"), row("2026-11-13")],
      keys,
      "day",
    );
    expect(points.map((point) => point.key)).toEqual(keys);
    expect(points.reduce((sum, point) => sum + point.recipients, 0)).toBe(100);
  });

  it("DB가 bigint를 문자열로 줘도 숫자로 바꾼다", () => {
    const points = fillTrend(
      [row("2026-11-13", { delivered: "7" as unknown as number })],
      keys,
      "day",
    );
    expect(points[2]?.delivered).toBe(7);
  });

  it("일별·월별 글자", () => {
    expect(fillTrend([], ["2026-11-03"], "day")[0]).toMatchObject({
      label: "11.03",
      fullLabel: "2026.11.03",
    });
    expect(fillTrend([], ["2026-01-01"], "month")[0]).toMatchObject({
      label: "1월",
      fullLabel: "2026년 1월",
    });
  });
});

describe("trendTotals", () => {
  it("결과가 없으면 비율은 0%가 아니라 null이다", () => {
    const totals = trendTotals(fillTrend([], ["2026-11-13"], "day"));
    expect(totals).toMatchObject({
      recipients: 0,
      deliveryRate: null,
      failureRate: null,
    });
  });

  it("분모에 확인 중을 넣어, 두 비율의 합은 100에서 확인 중 비율만큼 모자란다", () => {
    const points = fillTrend(
      [
        row("2026-11-12", { delivered: 600, pending: 100, failed: 100 }),
        row("2026-11-13", { delivered: 200, pending: 0, failed: 0 }),
      ],
      ["2026-11-12", "2026-11-13"],
      "day",
    );
    expect(trendTotals(points)).toMatchObject({
      campaigns: 2,
      recipients: 200,
      delivered: 800,
      pending: 100,
      failed: 100,
      deliveryRate: 80,
      failureRate: 10,
    });
  });

  it("비율은 소수 첫째 자리에서 반올림한다", () => {
    const points = fillTrend(
      [row("2026-11-13", { delivered: 2, pending: 0, failed: 1 })],
      ["2026-11-13"],
      "day",
    );
    expect(trendTotals(points)).toMatchObject({
      deliveryRate: 66.7,
      failureRate: 33.3,
    });
  });
});

describe("axisNumber", () => {
  it("축 최대가 1만 미만이면 그대로 쓴다", () => {
    expect(axisNumber(9_000, 9_999)).toBe("9,000");
  });

  it("축 최대가 1만 이상이면 같은 축의 모든 눈금을 만 단위로 줄인다", () => {
    expect(axisNumber(5_000, 20_000)).toBe("0.5만");
    expect(axisNumber(12_000, 20_000)).toBe("1.2만");
    expect(axisNumber(0, 20_000)).toBe("0만");
  });
});

describe("niceTicks", () => {
  it.each([
    [1_356, [0, 500, 1_000, 1_500]],
    [2_482, [0, 1_000, 2_000, 3_000]],
    [100, [0, 25, 50, 75, 100]],
    [3, [0, 1, 2, 3]],
    [10, [0, 5, 10]],
    [9, [0, 5, 10]],
    [1, [0, 1]],
    [45_000, [0, 20_000, 40_000, 60_000]],
  ])("최댓값 %d → %j", (max, ticks) => {
    expect(niceTicks(max)).toEqual(ticks);
  });

  it("보낸 게 없으면 0 하나다", () => {
    expect(niceTicks(0)).toEqual([0]);
  });

  it("마지막 눈금은 항상 최댓값 이상이다", () => {
    for (const max of [7, 99, 101, 999, 1_001, 12_345]) {
      expect(niceTicks(max).at(-1)).toBeGreaterThanOrEqual(max);
    }
  });
});
