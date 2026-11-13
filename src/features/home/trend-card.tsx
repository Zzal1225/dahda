"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowLink } from "@/components/ui/arrow-link";
import { Segmented } from "@/components/ui/segmented";
import type { KstBucketUnit } from "@/lib/kst";
import { trendTotals, type TrendPoint } from "./trend";
import { LegendSwatch, SERIES, won } from "./trend-series";

/**
 * 첫 화면 "발송 추이". 기간 합계, 범례, 막대 차트, 표 보기.
 *
 * 차트(Recharts)는 화면이 뜬 뒤에 따로 불러온다. 첫 화면 JS가 압축 기준 약 107KB(30%) 늘어서
 * 오늘 숫자·진행 중 같은 위쪽 내용이 그 때문에 늦게 뜨지 않게 한다. 차트 자리는 같은 높이로 비워 두어
 * 불러온 뒤 화면이 밀리지 않는다. 서버 렌더링을 끄는 이유: ResponsiveContainer는 폭을 재야 그릴 수 있다.
 *
 * 비율은 "오늘 도착률"과 같은 분모(trendTotals)라 오늘 칸과 위의 띠 숫자가 어긋나지 않는다.
 */
const TrendChart = dynamic(
  () => import("./trend-chart").then((module) => module.TrendChart),
  { ssr: false, loading: () => null },
);

const UNIT_OPTIONS: { value: KstBucketUnit; label: string }[] = [
  { value: "day", label: "일별 30일" },
  { value: "month", label: "월별 12개월" },
];

const rate = (value: number | null) => (value === null ? "—" : `${value}%`);

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-title tabular-nums">
        {value}
        {unit && (
          <span className="ml-0.5 text-body-sm font-bold text-text-muted">
            {unit}
          </span>
        )}
      </dd>
    </div>
  );
}

function RateStat({ label, value }: { label: string; value: number | null }) {
  return (
    <Stat
      label={label}
      value={value === null ? "—" : String(value)}
      unit={value === null ? undefined : "%"}
    />
  );
}

export function TrendCard({
  day,
  month,
}: {
  day: readonly TrendPoint[];
  month: readonly TrendPoint[];
}) {
  const [unit, setUnit] = useState<KstBucketUnit>("day");
  const [asTable, setAsTable] = useState(false);

  const points = unit === "day" ? day : month;
  const totals = trendTotals(points);
  const unitLabel = unit === "day" ? "최근 30일" : "최근 12개월";

  return (
    <section
      aria-label="발송 추이"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-body font-bold">발송 추이</h2>
          <span className="text-caption text-text-muted">
            {unitLabel} · 실제로 나가기 시작한 날 기준
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="추이 단위"
            value={unit}
            options={UNIT_OPTIONS}
            onChange={setUnit}
          />
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((value) => !value)}
            className="h-(--control-h) cursor-pointer rounded-md border border-border-strong px-3 text-caption font-bold outline-none focus-visible:ring-2 focus-visible:ring-focus aria-pressed:bg-surface-2"
          >
            표로 보기
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="총 발송" value={won(totals.recipients)} unit="건" />
        <Stat label="도착" value={won(totals.delivered)} unit="건" />
        <Stat label="실패" value={won(totals.failed)} unit="건" />
        <RateStat label="도착률" value={totals.deliveryRate} />
        <RateStat label="실패율" value={totals.failureRate} />
      </dl>
      {totals.pending > 0 && (
        <p className="-mt-2 text-caption text-text-muted tabular-nums">
          확인 중 {won(totals.pending)}건은 결과가 오면 도착이나 실패로
          바뀌어요. 비율의 분모에 포함돼요.
        </p>
      )}

      <ul
        aria-label="범례"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-muted"
      >
        {SERIES.map((series) => (
          <li key={series.key} className="inline-flex items-center gap-1.5">
            <LegendSwatch seriesKey={series.key} />
            {series.label}
          </li>
        ))}
      </ul>

      {totals.recipients === 0 ? (
        <div className="flex h-60 flex-col items-center justify-center gap-2 text-center">
          <p className="text-body-sm text-text-muted">
            {unitLabel} 동안 보낸 문자가 없어요
          </p>
          <ArrowLink href="/compose">문자 작성하기</ArrowLink>
        </div>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-body-sm tabular-nums">
            <caption className="sr-only">{unitLabel} 발송 추이 표</caption>
            <thead className="sticky top-0 bg-surface text-caption text-text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 text-left font-bold">
                  {unit === "day" ? "날짜" : "월"}
                </th>
                <th scope="col" className="py-2 text-right font-bold">
                  총 발송
                </th>
                {SERIES.map((series) => (
                  <th
                    key={series.key}
                    scope="col"
                    className="py-2 text-right font-bold"
                  >
                    {series.label}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right font-bold">
                  도착률
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 최신이 위. 표는 "어제 어땠나"를 찾으러 연다. */}
              {[...points].reverse().map((point) => (
                <tr key={point.key} className="border-b border-border">
                  <th scope="row" className="py-2 text-left font-normal">
                    {point.fullLabel}
                  </th>
                  <td className="py-2 text-right">{won(point.recipients)}</td>
                  {SERIES.map((series) => (
                    <td key={series.key} className="py-2 text-right">
                      {won(point[series.key])}
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    {rate(trendTotals([point]).deliveryRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="img"
          aria-label={`${unitLabel} 발송 추이 막대 차트. 총 ${won(totals.recipients)}건 중 도착 ${won(totals.delivered)}건, 실패 ${won(totals.failed)}건. 칸별 숫자는 표로 보기에서 볼 수 있어요.`}
          className="h-60"
        >
          <TrendChart points={points} />
        </div>
      )}
    </section>
  );
}
