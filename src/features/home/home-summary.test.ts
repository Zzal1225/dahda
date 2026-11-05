import { describe, expect, it } from "vitest";
import type { CampaignRow } from "@/features/campaigns/campaign-view";
import { summarizeToday, timeUntil } from "./home-summary";

const campaign = (over: Partial<CampaignRow>): CampaignRow => ({
  id: "c",
  branchId: null,
  branchName: null,
  body: "본문",
  kind: "sms",
  isAd: false,
  status: "sending",
  recipientCount: 0,
  unitPrice: 20,
  estimatedCost: 0,
  sentCount: 0,
  deliveredCount: 0,
  failedCount: 0,
  displayAt: "2026-11-05T00:00:00Z",
  scheduledAt: null,
  reviewedAt: null,
  rejectedReason: null,
  retryOfCampaignId: null,
  ...over,
});

describe("summarizeToday", () => {
  it("발송이 없으면 도착률을 0%가 아니라 없음으로 둔다", () => {
    expect(summarizeToday([])).toEqual({
      campaignCount: 0,
      recipientCount: 0,
      delivered: 0,
      pending: 0,
      failed: 0,
      deliveryRate: null,
    });
  });

  it("여러 발송 건을 합친다", () => {
    const summary = summarizeToday([
      campaign({
        recipientCount: 10,
        sentCount: 10,
        deliveredCount: 8,
        failedCount: 2,
      }),
      campaign({
        recipientCount: 5,
        sentCount: 5,
        deliveredCount: 5,
      }),
    ]);
    expect(summary).toMatchObject({
      campaignCount: 2,
      recipientCount: 15,
      delivered: 13,
      pending: 0,
      failed: 2,
    });
    expect(summary.deliveryRate).toBe(86.7);
  });

  it("대기 중인 건은 분모에서 빼고 확인 중인 건은 넣는다", () => {
    const summary = summarizeToday([
      campaign({ recipientCount: 100, sentCount: 10, deliveredCount: 5 }),
    ]);
    expect(summary.pending).toBe(5);
    expect(summary.deliveryRate).toBe(50);
  });

  it("접수 전에 거절돼도 실패로 센다", () => {
    const summary = summarizeToday([
      campaign({ recipientCount: 1, sentCount: 0, failedCount: 1 }),
    ]);
    expect(summary.deliveryRate).toBe(0);
    expect(summary.failed).toBe(1);
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
