"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelCampaign } from "@/features/campaigns/approval-actions";
import { CAMPAIGN_LIST_LIMIT } from "@/features/campaigns/campaign-query";
import { CampaignTable } from "@/features/campaigns/campaign-table";
import { DeliveryReceiptCard } from "@/features/campaigns/delivery-receipt-card";
import {
  campaignTitle,
  canCancelCampaign,
  fallbackPollMs,
  messageCounts,
  type CampaignRow,
} from "@/features/campaigns/campaign-view";
import {
  useLiveCampaigns,
  type LiveChange,
} from "@/features/campaigns/use-live-campaigns";
import { formatKstDateTime, formatKstTime, periodToRange } from "@/lib/kst";
import { createThrottle } from "@/lib/throttle";
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

const CAMPAIGN_REFRESH_MS = 1000;
const MESSAGE_REFRESH_MS = 2000;

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
  accountBranchId,
  liveFilter,
  branches,
}: {
  /** 사용자·역할·지점. 캐시 키의 앞부분이다. */
  scope: string;
  role: MemberRole;
  /** 내 잔액 계정. null이면 본사 계정이다. 취소 권한 판단에 쓴다. */
  accountBranchId: string | null;
  /** 구독 범위. 본사는 본사 전체, 지점은 자기 지점이다. */
  liveFilter: string;
  branches: readonly BranchOption[];
}) {
  const state = useTableState();
  const queryClient = useQueryClient();
  const { filters, campaign: selectedId } = state;
  const showBranch = role === "hq";

  // 범위 계산에 쓰는 현재 시각을 고정한다. 렌더마다 바뀌면 캐시 키가 매번 달라져 무한히 다시 조회한다.
  const [now] = useState(() => new Date());
  const range = useMemo(
    () => periodToRange(filters.period, filters.from, filters.to, now),
    [filters.period, filters.from, filters.to, now],
  );

  const router = useRouter();
  // 웹훅은 몰려서 온다. 변경마다 다시 읽으면 1만 건 발송에 1만 번 조회하므로 간격을 둔다.
  // 표는 페이지 크기가 크고 수신자 수도 많아 발송 건 목록보다 넓게 둔다.
  const throttles = useMemo(
    () => ({
      campaigns: createThrottle(() => {
        void queryClient.invalidateQueries({ queryKey: ["campaigns", scope] });
      }, CAMPAIGN_REFRESH_MS),
      messages: createThrottle(() => {
        void queryClient.invalidateQueries({
          // 화면에 있는 표만 다시 읽힌다. 나머지 발송 건은 다시 열 때 읽는다.
          queryKey: ["messages", scope],
          // 전체 건수는 발송 중에 변하지 않는다. 10만 행을 세는 비싼 쿼리를 건너뛴다.
          // 상태 필터가 있으면 건수가 변하지만, 완료 때 아래에서 맞춘다.
          predicate: (query) => query.queryKey.at(-1) !== "total",
        });
      }, MESSAGE_REFRESH_MS),
    }),
    [queryClient, scope],
  );
  useEffect(
    () => () => {
      throttles.campaigns.cancel();
      throttles.messages.cancel();
    },
    [throttles],
  );

  function handleLiveChange(change: LiveChange) {
    throttles.campaigns.call();
    if (change === null || change.id === selectedId) {
      throttles.messages.call();
    }
    if (change?.status === "completed") {
      // 실패분 환불이 상단 잔액에 보이게 한다. 잔액은 레이아웃이 서버에서 그린다.
      router.refresh();
      void queryClient.invalidateQueries({
        queryKey: ["messages", scope, change.id],
      });
    }
  }
  const liveStatus = useLiveCampaigns(liveFilter, handleLiveChange);

  const campaignsQuery = useQuery({
    queryKey: [
      "campaigns",
      scope,
      {
        from: range.from,
        to: range.to,
        branch: filters.branch,
        ad: filters.ad,
        kind: filters.kind,
        state: filters.state,
      },
    ],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        ad: filters.ad,
        kind: filters.kind,
      });
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (filters.branch) params.set("branch", filters.branch);
      if (filters.state) params.set("state", filters.state);
      return fetchCampaigns(params, signal);
    },
    // 구독이 끊긴 동안만 폴링한다. 안 하면 끊긴 사실을 모른 채 화면이 멈춘다.
    refetchInterval: (query) => fallbackPollMs(liveStatus, query.state.data),
  });

  const campaigns = campaignsQuery.data;
  const selected = campaigns?.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <h1 className="text-title-lg">발송 내역</h1>

      {/* 제목 옆 작은 링크는 처음 온 사람이 지나쳤다. 목록에 고정 행으로 넣으면 필터·건수·재발송에
          예외가 생겨, 목록 밖에 눈에 띄는 안내로 둔다. */}
      <aside
        aria-label="10만 행 샘플 안내"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary bg-primary-subtle px-5 py-3"
      >
        <p className="text-body-sm">
          <b>수신자 10만 명 발송 1건</b>을 한 표에서 끊김 없이 스크롤해 볼 수
          있어요. 모든 방문자가 함께 보는 읽기 전용 샘플이에요.
        </p>
        <Link
          href="/history/sample"
          className="flex-none text-body-sm font-bold text-primary underline"
        >
          10만 행 샘플 보기
        </Link>
      </aside>

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
                {campaignTitle(selected.body, selected.isAd, 40)}
              </h2>
              <span className="text-caption text-text-muted">
                {formatKstDateTime(selected.displayAt)} ·{" "}
                {selected.branchName ?? "본사"} · {selected.kind.toUpperCase()}
                {selected.isAd ? " · 광고" : ""} ·{" "}
                {selected.recipientCount.toLocaleString("ko-KR")}명
              </span>
              {selected.failedCount > 0 && state.selectedIds.size === 0 && (
                <span className="text-caption text-text-muted">
                  아래 표에서 실패한 행을 선택하면 다시 보낼 수 있어요
                </span>
              )}
            </div>
            {selected.status === "sending" && (
              <span className="flex flex-none items-center gap-1.5 text-caption text-text-muted">
                <span
                  aria-hidden
                  className="live-dot size-2 rounded-full bg-status-sent"
                />
                {liveStatus === "live" ? "실시간 갱신 중" : "10초마다 확인 중"}{" "}
                {formatKstTime(new Date(campaignsQuery.dataUpdatedAt))}
              </span>
            )}
            {selected.status === "completed" && (
              <span className="flex-none text-caption text-text-muted">
                결과 확정 · 더 이상 바뀌지 않아요
              </span>
            )}
            {canCancelCampaign(selected, accountBranchId, now) && (
              <ConfirmDialog
                title="예약을 취소할까요?"
                description="취소하면 차감한 금액이 돌아오고 문자는 나가지 않아요. 되돌릴 수 없어요."
                confirmLabel="예약 취소"
                onConfirm={async () => {
                  const result = await cancelCampaign(selected.id);
                  if (!result) {
                    await queryClient.invalidateQueries({
                      queryKey: ["campaigns"],
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ["messages"],
                    });
                  }
                  return result;
                }}
                trigger={(open) => (
                  <Button variant="secondary" onClick={open}>
                    예약 취소
                  </Button>
                )}
              />
            )}
          </div>
          {/* 보낸 건에만 둔다. 승인 대기·예약·반려·취소는 증명할 도착이 없어 빈 단계만 보이게 된다.
              key를 주지 않는다. 캐시 키에 발송 건 id가 있어 건이 바뀌면 다시 읽고, 형제인 수신자 표가 이미
              key={selected.id}를 써서 같은 key를 주면 React가 이전 확인증을 지우지 못하고 둘을 함께 그린다. */}
          {(selected.status === "sending" ||
            selected.status === "completed") && (
            <DeliveryReceiptCard scope={scope} campaign={selected} />
          )}
          {selected.rejectedReason && (
            <p
              role="note"
              className="mx-5 mb-4 rounded-md bg-surface-2 px-4 py-3 text-body-sm"
            >
              <b>반려 사유</b> {selected.rejectedReason}
            </p>
          )}
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
