import type { KstBucketUnit } from "@/lib/kst";

/**
 * 첫 화면 "발송 추이"의 계산. DB 함수 campaign_trend의 행을 빈 칸 없는 막대 목록과 기간 합계로 바꾼다.
 * 차트(Recharts)와 표 보기가 같은 목록을 쓴다. 표와 차트의 숫자가 다르면 어느 쪽도 믿을 수 없다.
 */

/** 칸 수. 일별은 한 달, 월별은 일 년. 더 길면 막대가 24px보다 얇아져 읽히지 않는다. */
export const TREND_SPAN: Record<KstBucketUnit, number> = { day: 30, month: 12 };

export type TrendRow = {
  bucket: string;
  campaign_count: number;
  recipient_count: number;
  delivered: number;
  pending: number;
  failed: number;
};

export type TrendPoint = {
  /** KST 날짜 YYYY-MM-DD(월별은 1일). */
  key: string;
  /** 축 글자. 일별 "11.13", 월별 "11월". */
  label: string;
  /** 툴팁·표 글자. 일별 "2026.11.13", 월별 "2026년 11월". */
  fullLabel: string;
  campaigns: number;
  recipients: number;
  delivered: number;
  pending: number;
  failed: number;
};

export type TrendTotals = {
  campaigns: number;
  recipients: number;
  delivered: number;
  pending: number;
  failed: number;
  /** 결과가 하나도 없으면 null. 0%로 보이면 전부 실패한 것처럼 읽힌다. */
  deliveryRate: number | null;
  failureRate: number | null;
};

function labels(key: string, unit: KstBucketUnit) {
  const [year, month, day] = key.split("-");
  return unit === "day"
    ? { label: `${month}.${day}`, fullLabel: `${year}.${month}.${day}` }
    : {
        label: `${Number(month)}월`,
        fullLabel: `${year}년 ${Number(month)}월`,
      };
}

/**
 * 키 순서대로 모든 칸을 만든다. 보낸 적 없는 날도 0으로 남긴다.
 * 빈 날을 빼면 막대 간격이 시간 간격과 달라져 "매일 보냈다"처럼 읽힌다.
 * 범위 밖의 행(키에 없는 날짜)은 버린다.
 */
export function fillTrend(
  rows: readonly TrendRow[],
  keys: readonly string[],
  unit: KstBucketUnit,
): TrendPoint[] {
  const byKey = new Map(rows.map((row) => [row.bucket, row]));
  return keys.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      ...labels(key, unit),
      campaigns: Number(row?.campaign_count ?? 0),
      recipients: Number(row?.recipient_count ?? 0),
      delivered: Number(row?.delivered ?? 0),
      pending: Number(row?.pending ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  });
}

const percent = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

/**
 * 기간 합계. 비율의 분모는 첫 화면 "오늘 도착률"과 같다(도착 + 확인 중 + 실패).
 * 확인 중을 빼면 먼저 도착한 몇 건만으로 100%가 나와 결과가 좋아 보인다.
 * 그래서 도착률 + 실패율이 100%가 아닐 수 있고, 나머지는 확인 중이다.
 */
export function trendTotals(points: readonly TrendPoint[]): TrendTotals {
  const sum = (pick: (point: TrendPoint) => number) =>
    points.reduce((total, point) => total + pick(point), 0);
  const delivered = sum((point) => point.delivered);
  const pending = sum((point) => point.pending);
  const failed = sum((point) => point.failed);
  const resulted = delivered + pending + failed;
  return {
    campaigns: sum((point) => point.campaigns),
    recipients: sum((point) => point.recipients),
    delivered,
    pending,
    failed,
    deliveryRate: percent(delivered, resulted),
    failureRate: percent(failed, resulted),
  };
}

/** y축 눈금 글자. 1만 이상은 "1.2만"으로 줄인다(한 축 안에서는 같은 방식). */
export function axisNumber(value: number, max: number): string {
  if (max < 10_000) return value.toLocaleString("ko-KR");
  const man = Math.round((value / 10_000) * 10) / 10;
  return `${man.toLocaleString("ko-KR")}만`;
}

/**
 * y축 눈금. 1·2·2.5·5 × 10ⁿ 간격으로 4칸 안팎이 되게 고른다. Recharts 기본값은 최댓값을 균등 분할해
 * 350·1,050처럼 읽기 어려운 숫자가 나온다. 건수라 간격은 1 이상이다.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // 2.5 간격은 10 이상에서만 쓴다. 작은 값에서 2.5를 반올림하면 0·3·5·8처럼 간격이 고르지 않다.
  const factors = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const factor = factors.find((f) => f * magnitude >= rough) ?? 10;
  const step = Math.max(1, factor * magnitude);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) =>
    Math.round(i * step),
  );
}
