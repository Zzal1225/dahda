import { describe, expect, it } from "vitest";
import {
  campaignCost,
  campaignStatusView,
  campaignTitle,
  canCancelCampaign,
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
  scheduledAt: null,
  reviewedAt: null,
  rejectedReason: null,
};

describe("campaignTitle", () => {
  it("20자까지는 그대로 둔다", () => {
    expect(campaignTitle("가".repeat(20), false)).toBe("가".repeat(20));
  });

  it("넘으면 자르고 말줄임표를 붙인다", () => {
    expect(campaignTitle("가".repeat(21), false)).toBe(`${"가".repeat(20)}…`);
  });

  it("광고는 앞뒤 고정 문구를 빼고 내용을 보여 준다", () => {
    expect(
      campaignTitle(
        "(광고)dahda마트 010-0000-0001\n주말 특가\n무료거부 080",
        true,
      ),
    ).toBe("주말 특가");
  });

  it("광고 본문이 여러 줄이어도 내용을 이어서 보여 준다", () => {
    expect(campaignTitle("(광고)a\n첫째\n둘째\n무료거부", true)).toBe(
      "첫째 둘째",
    );
  });

  it("고정 문구가 없는 형식이면 전체를 보여 준다", () => {
    expect(campaignTitle("한 줄", true)).toBe("한 줄");
  });

  it("비광고는 줄바꿈이 있어도 그대로 쓴다", () => {
    expect(campaignTitle("첫째\n둘째\n셋째", false)).toBe("첫째\n둘째\n셋째");
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

describe("canCancelCampaign", () => {
  const NOW = new Date("2026-11-04T00:00:00Z");
  const scheduled: CampaignRow = {
    ...base,
    status: "scheduled",
    scheduledAt: "2026-11-05T00:00:00Z",
  };

  it("계정 주인의 시각 전 예약을 취소할 수 있다", () => {
    expect(canCancelCampaign(scheduled, "b1", NOW)).toBe(true);
  });

  it.each<[string, Partial<CampaignRow>, string | null]>([
    ["승인된 건", { reviewedAt: "2026-11-04T00:00:00Z" }, "b1"],
    ["지금 보내기", { scheduledAt: null }, "b1"],
    ["시각이 지난 건", { scheduledAt: "2026-11-03T00:00:00Z" }, "b1"],
    ["발송 중", { status: "sending" }, "b1"],
    ["옆 지점", {}, "b2"],
    ["본사가 지점 건을", {}, null],
  ])("%s는 취소할 수 없다", (_, patch, account) => {
    expect(canCancelCampaign({ ...scheduled, ...patch }, account, NOW)).toBe(
      false,
    );
  });

  it("본사는 본사 발송 건을 취소할 수 있다", () => {
    expect(canCancelCampaign({ ...scheduled, branchId: null }, null, NOW)).toBe(
      true,
    );
  });
});
