import { describe, expect, it } from "vitest";
import { timeUntil, toTodaySummary } from "./home-summary";

const totals = (over = {}) => ({
  campaign_count: 2,
  recipient_count: 15,
  delivered: 13,
  pending: 0,
  failed: 2,
  ...over,
});

describe("toTodaySummary", () => {
  it("발송이 없으면 도착률을 0%가 아니라 없음으로 둔다", () => {
    expect(
      toTodaySummary(
        totals({
          campaign_count: 0,
          recipient_count: 0,
          delivered: 0,
          failed: 0,
        }),
      ).deliveryRate,
    ).toBeNull();
  });

  it("합계가 없어도 0으로 보여 준다", () => {
    expect(toTodaySummary(undefined)).toEqual({
      campaignCount: 0,
      recipientCount: 0,
      delivered: 0,
      pending: 0,
      failed: 0,
      deliveryRate: null,
    });
  });

  it("합계를 그대로 옮기고 도착률을 계산한다", () => {
    expect(toTodaySummary(totals())).toEqual({
      campaignCount: 2,
      recipientCount: 15,
      delivered: 13,
      pending: 0,
      failed: 2,
      deliveryRate: 86.7,
    });
  });

  it("확인 중인 건은 분모에 넣는다", () => {
    expect(
      toTodaySummary(totals({ delivered: 5, pending: 5, failed: 0 }))
        .deliveryRate,
    ).toBe(50);
  });

  it("전부 실패하면 0%다", () => {
    expect(
      toTodaySummary(totals({ delivered: 0, pending: 0, failed: 1 }))
        .deliveryRate,
    ).toBe(0);
  });
});

describe("timeUntil", () => {
  const now = new Date("2026-11-05T00:00:00Z");

  it.each([
    ["2026-11-05T00:30:00Z", "30분 뒤 발송"],
    ["2026-11-05T02:00:00Z", "2시간 뒤 발송"],
    ["2026-11-05T02:05:00Z", "2시간 5분 뒤 발송"],
    ["2026-11-05T00:00:01Z", "1분 뒤 발송"],
  ])("%s는 %s", (target, expected) => {
    expect(timeUntil(target, now)).toBe(expected);
  });

  it("시각이 없거나 지났으면 곧 발송이다", () => {
    expect(timeUntil(null, now)).toBe("곧 발송");
    expect(timeUntil("2026-11-04T23:00:00Z", now)).toBe("곧 발송");
  });
});
