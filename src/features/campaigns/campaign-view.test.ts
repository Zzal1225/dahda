import { describe, expect, it } from "vitest";
import {
  campaignCost,
  campaignStatusView,
  campaignTitle,
  messageCounts,
  type CampaignRow,
} from "./campaign-view";
import type { CampaignStatus } from "./status";

const base: CampaignRow = {
  id: "c1",
  branchId: "b1",
  branchName: "성수점",
  body: "본문",
  kind: "sms",
  isAd: false,
  status: "sending",
  recipientCount: 100,
  unitPrice: 20,
  estimatedCost: 2000,
  sentCount: 90,
  deliveredCount: 70,
  failedCount: 5,
  displayAt: "2026-11-04T00:00:00Z",
};

describe("campaignTitle", () => {
  it("20자까지는 그대로 둔다", () => {
    expect(campaignTitle("가".repeat(20))).toBe("가".repeat(20));
  });

  it("넘으면 자르고 말줄임표를 붙인다", () => {
    expect(campaignTitle("가".repeat(21))).toBe(`${"가".repeat(20)}…`);
  });
});

describe("messageCounts", () => {
  it("접수 누계에서 확정 건을 빼 확인 중을 구한다", () => {
    expect(messageCounts(base)).toEqual({
      queued: 25 - 15,
      sent: 15,
      delivered: 70,
      failed: 5,
    });
  });

  it("합계가 수신자 수와 같다", () => {
    const { queued, sent, delivered, failed } = messageCounts(base);
    expect(queued + sent + delivered + failed).toBe(base.recipientCount);
  });

  it("보내기 전 영구 실패가 있어 접수 누계보다 확정이 많아도 음수가 되지 않는다", () => {
    const counts = messageCounts({
      ...base,
      sentCount: 10,
      deliveredCount: 10,
      failedCount: 20,
    });
    expect(counts).toEqual({ queued: 70, sent: 0, delivered: 10, failed: 20 });
  });
});

describe("campaignCost", () => {
  it("실패 건은 비용이 없다", () => {
    expect(campaignCost(base)).toEqual({ estimated: false, amount: 1900 });
  });

  it.each<CampaignStatus>(["draft", "pending_approval", "scheduled"])(
    "%s는 예상 금액이다",
    (status) => {
      expect(campaignCost({ ...base, status })).toEqual({
        estimated: true,
        amount: 2000,
      });
    },
  );

  it.each<CampaignStatus>(["rejected", "canceled"])(
    "%s는 차감되지 않아 0원이다",
    (status) => {
      expect(campaignCost({ ...base, status })).toEqual({
        estimated: false,
        amount: 0,
      });
    },
  );
});

describe("campaignStatusView", () => {
  it.each<[CampaignStatus, string]>([
    ["sending", "확인 중"],
    ["completed", "완료"],
    ["scheduled", "예약"],
    ["pending_approval", "승인 대기"],
    ["rejected", "반려"],
    ["canceled", "취소"],
  ])("%s → %s", (status, label) => {
    expect(campaignStatusView(status).label).toBe(label);
  });
});
