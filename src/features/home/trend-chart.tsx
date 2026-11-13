"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { axisNumber, niceTicks, type TrendPoint } from "./trend";
import { LegendSwatch, SERIES, won, type SeriesKey } from "./trend-series";

/**
 * 발송 추이 막대(Recharts). trend-card.tsx가 화면이 뜬 뒤에 불러온다(next/dynamic).
 * Recharts는 첫 화면 JS를 압축 기준 약 107KB 늘린다(docs/performance.md 측정 6).
 *
 * 색은 기존 상태 토큰만 쓴다(도착=초록, 확인 중=회청, 실패=빨강). 검사 스크립트(dataviz validate_palette)로 보니
 * 도착·실패는 적록 색약에서 가깝고(ΔE 6.3), 확인 중·도착은 정상 시각에서도 가깝다(ΔE 13.8).
 * 그래서 색만으로 구분하지 않는다: 확인 중은 빗금, 조각 사이 2px 간격, 쌓는 순서 고정, 범례, 툴팁, 표 보기.
 */

/** 맨 위 조각만 끝을 둥글게 한다. 가운데 조각까지 둥글면 막대가 마디처럼 끊겨 보인다. */
function topOf(point: TrendPoint): SeriesKey | null {
  if (point.failed > 0) return "failed";
  if (point.pending > 0) return "pending";
  if (point.delivered > 0) return "delivered";
  return null;
}

type SegmentProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: TrendPoint;
};

/** Recharts는 shape 함수를 컴포넌트가 아니라 함수로 부른다. 그래서 렌더마다 새로 만들어도 다시 붙지 않는다. */
function segmentShape(key: SeriesKey, hatchId: string) {
  return function renderSegment(props: SegmentProps) {
    const { payload, height = 0 } = props;
    if (!payload || height <= 0) return <g />;
    const top = topOf(payload) === key;
    return (
      <Rectangle
        x={props.x}
        y={props.y}
        width={props.width}
        height={height}
        radius={top ? [4, 4, 0, 0] : 0}
        // 조각 사이 2px: 위아래 조각이 각각 1px씩 바탕색 테두리를 가진다.
        stroke="var(--surface)"
        strokeWidth={1}
        fill={key === "pending" ? `url(#${hatchId})` : undefined}
        className={cn(
          key === "delivered" && "fill-status-delivered",
          key === "failed" && "fill-status-failed",
        )}
      />
    );
  };
}

type TooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
};

/** 값이 앞, 이름이 뒤. 툴팁을 여는 사람은 이미 계열을 알고 숫자를 찾는다. */
function TrendTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload as TrendPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="flex min-w-36 flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-caption shadow-[0_4px_12px_rgba(28,23,24,.08)]">
      <span className="font-bold">{point.fullLabel}</span>
      <span className="text-text-muted tabular-nums">
        총 {won(point.recipients)}건 · 발송 건 {point.campaigns}개
      </span>
      {SERIES.map((series) => (
        <span key={series.key} className="flex items-center gap-2 tabular-nums">
          <LegendSwatch seriesKey={series.key} />
          <b>{won(point[series.key])}</b>
          <span className="text-text-muted">{series.label}</span>
        </span>
      ))}
    </div>
  );
}

export function TrendChart({ points }: { points: readonly TrendPoint[] }) {
  // useId의 콜론 등은 url(#...) 안에서 깨질 수 있어 글자와 숫자만 남긴다.
  const hatchId = `trend-hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const maxStack = Math.max(
    0,
    ...points.map((point) => point.delivered + point.pending + point.failed),
  );
  const ticks = niceTicks(maxStack);
  const axisMax = ticks.at(-1) ?? 0;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[...points]}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        barCategoryGap="20%"
        accessibilityLayer={false}
      >
        <defs>
          <pattern
            id={hatchId}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" className="fill-surface" />
            <rect width="2" height="4" className="fill-status-sent" />
          </pattern>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          minTickGap={12}
          interval="preserveStartEnd"
        />
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          ticks={ticks}
          domain={[0, axisMax]}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickFormatter={(value: number) => axisNumber(value, axisMax)}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={TrendTooltip}
          isAnimationActive={false}
        />
        {SERIES.map((series) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            stackId="status"
            maxBarSize={24}
            isAnimationActive={false}
            shape={segmentShape(series.key, hatchId)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
