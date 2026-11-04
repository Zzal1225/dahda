"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_LIST_LIMIT } from "@/features/campaigns/campaign-query";
import { CampaignTable } from "@/features/campaigns/campaign-table";
import {
  campaignTitle,
  messageCounts,
  type CampaignRow,
} from "@/features/campaigns/campaign-view";
import { formatKstDateTime, periodToRange } from "@/lib/kst";
import type { MemberRole } from "@/server/auth/to-current-member";
import { HistoryFilters, type BranchOption } from "./history-filters";
import { RecipientTable } from "./recipient-table";
import { useTableState } from "./useTableState";

async function fetchCampaigns(
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<CampaignRow[]> {
  const response = await fetch(`/api/campaigns?${params}`, { signal });
  if (!response.ok) throw new Error(`발송 건 조회 실패: ${response.status}`);
  return (await response.json()) as CampaignRow[];
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-7 rounded-sm bg-skeleton" />
      ))}
    </div>
  );
}

export function HistoryScreen({
  scope,
  role,
  branches,
}: {
  /** 사용자·역할·지점. 캐시 키의 앞부분이다. */
  scope: string;
  role: MemberRole;
  branches: readonly BranchOption[];
}) {
  const state = useTableState();
  const { filters, campaign: selectedId } = state;
  const showBranch = role === "hq";

  // 범위 계산에 쓰는 현재 시각을 고정한다. 렌더마다 바뀌면 캐시 키가 매번 달라져 무한히 다시 조회한다.
  const [now] = useState(() => new Date());
  const range = useMemo(
    () => periodToRange(filters.period, filters.from, filters.to, now),
    [filters.period, filters.from, filters.to, now],
  );

  const campaignsQuery = useQuery({
    queryKey: [
      "campaigns",
      scope,
      {
        from: range.from,
        to: range.to,
        branch: filters.branch,
        ad: filters.ad,
      },
    ],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ ad: filters.ad });
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (filters.branch) params.set("branch", filters.branch);
      return fetchCampaigns(params, signal);
    },
  });

  const campaigns = campaignsQuery.data;
  const selected = campaigns?.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <h1 className="text-title-lg">발송 내역</h1>

      <HistoryFilters
        state={state}
        branches={branches}
        showBranch={showBranch}
        counts={selected ? messageCounts(selected) : null}
      />

      <section
        aria-label="발송 건"
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div className="flex items-baseline justify-between gap-4 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title">발송 건</h2>
            {campaigns && (
              <span className="text-body-sm text-text-muted">
                {campaigns.length}건
              </span>
            )}
          </div>
          <span className="text-caption text-text-muted">
            행을 누르면 수신자별 결과가 아래에 열립니다
          </span>
        </div>

        {campaignsQuery.isPending && <TableSkeleton rows={4} />}

        {campaignsQuery.isError && (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 p-12 text-center"
          >
            <p className="text-body-sm text-text-muted">
              발송 건을 불러오지 못했어요
            </p>
            <Button
              variant="secondary"
              onClick={() => void campaignsQuery.refetch()}
            >
              다시 시도
            </Button>
          </div>
        )}

        {campaigns?.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-body-sm text-text-muted">
              이 조건에 맞는 발송 건이 없어요
            </p>
            {state.activeFilterCount > 0 && (
              <Button variant="secondary" onClick={state.clearFilters}>
                필터 모두 지우기
              </Button>
            )}
          </div>
        )}

        {campaigns && campaigns.length > 0 && (
          <CampaignTable
            campaigns={campaigns}
            selectedId={selectedId}
            showBranch={showBranch}
            onSelect={state.setCampaign}
          />
        )}

        {campaigns?.length === CAMPAIGN_LIST_LIMIT && (
          <p className="border-t border-border p-3 text-center text-caption text-text-muted">
            최근 {CAMPAIGN_LIST_LIMIT}건까지 보여 줘요. 기간을 좁혀 찾아보세요.
          </p>
        )}
      </section>

      {selected && (
        <section
          aria-label="수신자별 결과"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="truncate text-title">
                {campaignTitle(selected.body, 40)}
              </h2>
              <span className="text-caption text-text-muted">
                {formatKstDateTime(selected.displayAt)} ·{" "}
                {selected.branchName ?? "본사"} · {selected.kind.toUpperCase()}
                {selected.isAd ? " · 광고" : ""} ·{" "}
                {selected.recipientCount.toLocaleString("ko-KR")}명
              </span>
            </div>
            {selected.status === "completed" && (
              <span className="flex-none text-caption text-text-muted">
                결과 확정 · 더 이상 바뀌지 않아요
              </span>
            )}
          </div>
          {/* key로 발송 건마다 새로 만들어 스크롤·요청 상태가 이전 건에서 넘어오지 않게 한다. */}
          <RecipientTable
            key={selected.id}
            scope={scope}
            campaignId={selected.id}
            state={state}
          />
        </section>
      )}
    </>
  );
}
