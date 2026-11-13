import { cn } from "@/lib/utils";

/**
 * 발송 추이의 계열(쌓는 순서 고정: 아래부터 도착 → 확인 중 → 실패)과 견본.
 * 카드(범례·표)와 차트(막대·툴팁)가 같이 쓴다. 차트는 따로 늦게 불러오므로(trend-card.tsx)
 * 이 파일에는 Recharts를 넣지 않는다.
 */
export const SERIES = [
  { key: "delivered", label: "도착" },
  { key: "pending", label: "확인 중" },
  { key: "failed", label: "실패" },
] as const;
export type SeriesKey = (typeof SERIES)[number]["key"];

export const won = (value: number) => value.toLocaleString("ko-KR");

/** 막대와 같은 견본. 확인 중은 첫 화면 진행 막대처럼 빗금이라 색을 못 가려도 구분된다. */
export function LegendSwatch({ seriesKey }: { seriesKey: SeriesKey }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 rounded-[2px]",
        seriesKey === "delivered" && "bg-status-delivered",
        seriesKey === "pending" &&
          "bg-[repeating-linear-gradient(135deg,var(--st-sent)_0_2px,var(--surface)_2px_4px)]",
        seriesKey === "failed" && "bg-status-failed",
      )}
    />
  );
}
