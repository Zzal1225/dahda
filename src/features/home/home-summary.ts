export type TodayTotals = {
  campaign_count: number;
  recipient_count: number;
  delivered: number;
  pending: number;
  failed: number;
};

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
 * 합계는 today_campaign_summary가 DB에서 낸다. 여기서는 도착률만 계산한다.
 * 대기 중인 건은 분모에 없다. 넣으면 발송 도중 도착률이 낮아 보인다.
 * 확인 중은 분모에 넣는다. 빼면 앞서 도착한 몇 건만으로 100%가 나와 결과가 좋아 보인다.
 */
export function toTodaySummary(totals: TodayTotals | undefined): TodaySummary {
  const delivered = totals?.delivered ?? 0;
  const pending = totals?.pending ?? 0;
  const failed = totals?.failed ?? 0;
  const accepted = delivered + pending + failed;
  return {
    campaignCount: totals?.campaign_count ?? 0,
    recipientCount: totals?.recipient_count ?? 0,
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
