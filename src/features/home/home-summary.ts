import {
  messageCounts,
  type CampaignRow,
} from "@/features/campaigns/campaign-view";

export type TodaySummary = {
  campaignCount: number;
  recipientCount: number;
  delivered: number;
  pending: number;
  failed: number;
  /** 아직 접수된 건이 없으면 null이다. 0%로 보이면 전부 실패한 것처럼 읽힌다. */
  deliveryRate: number | null;
};

/**
 * 오늘 숫자. 대기 중인 건은 분모에서 뺀다. 넣으면 발송 도중 도착률이 낮아 보인다.
 * 확인 중은 분모에 넣는다. 빼면 앞서 도착한 몇 건만으로 100%가 나와 결과가 좋아 보인다.
 */
export function summarizeToday(
  campaigns: readonly CampaignRow[],
): TodaySummary {
  let recipientCount = 0;
  let delivered = 0;
  let pending = 0;
  let failed = 0;
  for (const campaign of campaigns) {
    const counts = messageCounts(campaign);
    recipientCount += campaign.recipientCount;
    delivered += counts.delivered;
    pending += counts.sent;
    failed += counts.failed;
  }
  const accepted = delivered + pending + failed;
  return {
    campaignCount: campaigns.length,
    recipientCount,
    delivered,
    pending,
    failed,
    deliveryRate:
      accepted === 0 ? null : Math.round((delivered / accepted) * 1000) / 10,
  };
}

/** "n시간 m분 뒤 발송". 이미 지났으면 워커가 곧 집으므로 시간을 말하지 않는다. */
export function timeUntil(target: string | null, now: Date): string {
  const minutes = target
    ? Math.ceil((new Date(target).getTime() - now.getTime()) / 60_000)
    : 0;
  if (minutes <= 0) return "곧 발송";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분 뒤 발송`;
  return rest === 0 ? `${hours}시간 뒤 발송` : `${hours}시간 ${rest}분 뒤 발송`;
}
