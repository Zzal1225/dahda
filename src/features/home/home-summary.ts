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

/**
 * 첫 화면 제목. "홈"은 어디서나 같아 정보가 없다. 누구로, 언제 보고 있는지를 제목에 둔다.
 * 체험 본사 이름이 "OO 본사"라 역할명과 겹치므로 끝의 " 본사"는 뗀다. 다른 이름은 그대로다.
 */
export function homeTitle(
  member: { orgName: string; role: "hq" | "branch"; branchName: string | null },
  today: string,
): string {
  const org = member.orgName.replace(/\s*본사$/, "");
  const role =
    member.role === "hq"
      ? "본사 관리자"
      : `${member.branchName ?? "지점"} 담당자`;
  return `${org} ${role} · ${today}`;
}

/**
 * 잔액으로 보낼 수 있는 SMS 건수의 대략값. 1만 건 이상은 만 단위 소수 한 자리(내림)로 줄인다.
 * 내림인 이유: "약 6.6만 건"이라고 했는데 6.55만 건만 나가면 약속을 어긴 셈이다.
 */
export function smsEstimate(balance: number, unitPrice: number): string {
  const count =
    unitPrice > 0 ? Math.max(0, Math.floor(balance / unitPrice)) : 0;
  if (count < 10_000) return `SMS 약 ${count.toLocaleString("ko-KR")}건`;
  const man = Math.floor(count / 1_000) / 10;
  return `SMS 약 ${man.toLocaleString("ko-KR")}만 건`;
}

const ACTIVE_ORDER = { sending: 0, scheduled: 1, completed: 2 } as const;

/** 진행 중 → 예약 → 오늘 끝난 건. 같은 단계는 받은 순서(최신순)를 지킨다. */
export function sortActive<T extends { status: string }>(
  rows: readonly T[],
): T[] {
  const rank = (status: string) =>
    ACTIVE_ORDER[status as keyof typeof ACTIVE_ORDER] ?? 3;
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status));
}

/** 끝났고 한 건도 빠짐없이 도착했다. 진행 막대 대신 "도착 확인" 도장을 찍는다. */
export function isFullyDelivered(campaign: {
  status: string;
  recipientCount: number;
  deliveredCount: number;
}): boolean {
  return (
    campaign.status === "completed" &&
    campaign.recipientCount > 0 &&
    campaign.deliveredCount === campaign.recipientCount
  );
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
