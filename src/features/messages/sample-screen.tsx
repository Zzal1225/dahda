"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { PUBLIC_SAMPLE_CAMPAIGN_ID } from "./public-sample";
import { RecipientTable } from "./recipient-table";
import { useTableState } from "./useTableState";

const STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delivered", label: "도착" },
  { value: "sent", label: "접수" },
  { value: "failed", label: "실패" },
] as const;

/**
 * 10만 행 표를 체험하는 읽기 전용 화면. 표와 URL 상태는 발송 내역과 같은 코드다.
 * 샘플은 체험 사용자의 조직이 아니므로 재발송을 열지 않는다.
 */
export function SampleScreen({ total }: { total: number }) {
  const state = useTableState();
  const { filters, setFilters } = state;
  const [search, setSearch] = useState(filters.q);

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => setFilters({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  const status = filters.status.length === 1 ? filters.status[0] : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title-lg">
          {total.toLocaleString("ko-KR")}행 샘플
        </h1>
        <p className="text-body-sm text-text-muted">
          {total.toLocaleString("ko-KR")}행이 나뉘지 않은 한 스크롤이에요.
          화면에 보이는 행만 그리고(표 아래 &quot;그린 행&quot;), 스크롤이 멈춘
          자리의 행만 서버에서 받아요. 공용 샘플이라 읽기만 할 수 있고, 내
          잔액과 발송 내역에는 영향이 없어요.{" "}
          <Link href="/history" className="underline">
            발송 내역으로 돌아가기
          </Link>
        </p>
      </div>

      <section
        aria-label="샘플 필터"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <Segmented
          label="상태"
          value={status ?? "all"}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            setFilters({ status: value === "all" ? [] : [value] })
          }
        />
        <Input
          type="search"
          inputMode="numeric"
          aria-label="수신번호 검색"
          placeholder="수신번호 앞자리 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="ml-auto w-[200px]"
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <RecipientTable
          scope="public-sample"
          campaignId={PUBLIC_SAMPLE_CAMPAIGN_ID}
          state={state}
          endpoint="/api/messages/sample"
          readOnly
        />
      </section>
    </div>
  );
}
