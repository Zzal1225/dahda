import type { CampaignStatus } from "./status";

/** 화면에 필요한 값만 담은 발송 건. 금액·집계 계산은 표에 흩어지지 않게 이 파일에 둔다. */
export type CampaignRow = {
  id: string;
  branchId: string | null;
  branchName: string | null;
  body: string;
  kind: "sms" | "lms";
  isAd: boolean;
  status: CampaignStatus;
  recipientCount: number;
  unitPrice: number;
  estimatedCost: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  /** 보낸 시각. 아직 보내기 전이면 예약 시각, 그것도 없으면 작성 시각이다. */
  displayAt: string;
  scheduledAt: string | null;
  reviewedAt: string | null;
  rejectedReason: string | null;
};

/**
 * 광고의 첫 줄은 (광고)와 전송자 고정 문구라 모든 건이 똑같아 보인다. 사용자가 쓴 내용의 첫 부분을 제목으로 쓴다.
 */
export function campaignTitle(
  body: string,
  isAd: boolean,
  length = 20,
): string {
  const lines = body.split("\n");
  const text = isAd && lines.length >= 3 ? lines.slice(1, -1).join(" ") : body;
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export type MessageCounts = {
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
};

/**
 * 메시지 10만 행을 세지 않고 발송 건의 집계에서 계산한다.
 * sent_count는 업체가 접수한 누계라 그중 결과가 확정된 건을 빼야 "확인 중"이 된다.
 * 집계가 잠시 어긋나도 음수를 보여 주지 않는다.
 */
export function messageCounts(campaign: CampaignRow): MessageCounts {
  const final = campaign.deliveredCount + campaign.failedCount;
  const sent = Math.max(0, campaign.sentCount - final);
  return {
    queued: Math.max(0, campaign.recipientCount - final - sent),
    sent,
    delivered: campaign.deliveredCount,
    failed: campaign.failedCount,
  };
}

export type CampaignCost = { estimated: boolean; amount: number };

const NOT_SENT_YET: readonly CampaignStatus[] = [
  "draft",
  "pending_approval",
  "scheduled",
];

/** 실패 건은 비용이 없다. 보내기 전이면 예상 금액이고, 반려·취소는 차감되지 않으므로 0원이다. */
export function campaignCost(campaign: CampaignRow): CampaignCost {
  if (NOT_SENT_YET.includes(campaign.status)) {
    return { estimated: true, amount: campaign.estimatedCost };
  }
  if (campaign.status === "rejected" || campaign.status === "canceled") {
    return { estimated: false, amount: 0 };
  }
  return {
    estimated: false,
    amount:
      (campaign.recipientCount - campaign.failedCount) * campaign.unitPrice,
  };
}

export type StatusTone =
  | "idle"
  | "sent"
  | "delivered"
  | "failed"
  | "pending"
  | "approved"
  | "rejected";

const CAMPAIGN_STATUS: Record<
  CampaignStatus,
  { label: string; tone: StatusTone }
> = {
  draft: { label: "작성 중", tone: "idle" },
  pending_approval: { label: "승인 대기", tone: "pending" },
  rejected: { label: "반려", tone: "rejected" },
  scheduled: { label: "예약", tone: "idle" },
  sending: { label: "확인 중", tone: "sent" },
  completed: { label: "완료", tone: "delivered" },
  canceled: { label: "취소", tone: "idle" },
};

export function campaignStatusView(status: CampaignStatus) {
  return CAMPAIGN_STATUS[status];
}

/**
 * 예약 취소 버튼을 보여 줄지. 서버와 DB 함수가 다시 확인하므로 화면 편의를 위한 판단이다.
 * 계정 주인만, 승인을 거치지 않은 예약이, 시각 전일 때만 취소할 수 있다.
 */
export function canCancelCampaign(
  campaign: Pick<
    CampaignRow,
    "status" | "reviewedAt" | "scheduledAt" | "branchId"
  >,
  accountBranchId: string | null,
  now: Date,
): boolean {
  return (
    campaign.status === "scheduled" &&
    campaign.reviewedAt === null &&
    campaign.branchId === accountBranchId &&
    campaign.scheduledAt !== null &&
    new Date(campaign.scheduledAt) > now
  );
}
