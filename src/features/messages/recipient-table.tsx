"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatPhone } from "@/lib/format";
import { formatKstTime } from "@/lib/kst";
import { cn } from "@/lib/utils";
import type { MessagePage, MessageRow } from "./message-query";
import {
  failReason,
  MESSAGE_STATUS_VIEW,
  pageOfIndex,
  pagesForRange,
} from "./message-view";
import { RetryBar } from "./retry-bar";
import { PAGE_SIZES, type SortColumn, type TableState } from "./table-state";

const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 468;
const OVERSCAN = 2;
// 빠르게 스크롤할 때 지나가는 페이지까지 요청하지 않으려고 멈춘 뒤에 받는다.
const FETCH_DEBOUNCE_MS = 120;

const column = createColumnHelper<typeof dataTableFeatures, MessageRow>();

type PageRequest = {
  /** 보는 사람과 역할. 키에 없으면 역할을 바꾼 뒤 이전 역할의 캐시가 그대로 보인다. */
  scope: string;
  campaignId: string;
  status: MessageRow["status"][];
  q: string;
  sort: TableState["sort"];
  pageSize: number;
};

function buildSearchParams(
  request: PageRequest,
  offset: number,
  limit: number,
  withTotal: boolean,
): URLSearchParams {
  const params = new URLSearchParams({
    campaignId: request.campaignId,
    offset: String(offset),
    limit: String(limit),
    sort: request.sort.column,
    desc: request.sort.desc ? "1" : "0",
  });
  for (const status of request.status) params.append("status", status);
  if (request.q) params.set("q", request.q);
  if (withTotal) params.set("withTotal", "1");
  return params;
}

async function fetchMessages(
  endpoint: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<MessagePage> {
  const response = await fetch(`${endpoint}?${params}`, { signal });
  if (!response.ok) throw new Error(`메시지 조회 실패: ${response.status}`);
  return (await response.json()) as MessagePage;
}

// 캐시 키에 조회 조건을 모두 넣는다. 조건이 하나라도 다르면 다른 결과이기 때문이다.
const messageKeys = {
  all: (request: PageRequest) =>
    [
      "messages",
      request.scope,
      request.campaignId,
      { status: request.status, q: request.q, sort: request.sort },
    ] as const,
  total: (request: PageRequest) =>
    [...messageKeys.all(request), "total"] as const,
  page: (request: PageRequest, page: number) =>
    [...messageKeys.all(request), request.pageSize, page] as const,
};

function SortHeader({
  label,
  column: sortColumn,
  sort,
  onToggle,
}: {
  label: string;
  column: SortColumn;
  sort: TableState["sort"];
  onToggle: (column: SortColumn) => void;
}) {
  const active = sort.column === sortColumn;
  const Icon = sort.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortColumn)}
      aria-label={`${label} 정렬${active ? (sort.desc ? ", 현재 최신순" : ", 현재 오래된순") : ""}`}
      className="flex cursor-pointer items-center gap-1 font-bold outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {label}
      {active && <Icon aria-hidden className="size-3" />}
    </button>
  );
}

function PageCheckbox({
  ids,
  selectedIds,
  onToggle,
}: {
  ids: readonly number[];
  selectedIds: ReadonlySet<number>;
  onToggle: () => void;
}) {
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const all = ids.length > 0 && selectedCount === ids.length;
  const some = selectedCount > 0 && !all;
  return (
    <input
      type="checkbox"
      aria-label="현재 페이지 전체 선택"
      checked={all}
      ref={(element) => {
        if (element) element.indeterminate = some;
      }}
      onChange={onToggle}
      disabled={ids.length === 0}
      className="size-4 cursor-pointer accent-primary"
    />
  );
}

export function RecipientTable({
  scope,
  campaignId,
  state,
  endpoint = "/api/messages",
  readOnly = false,
}: {
  scope: string;
  campaignId: string;
  state: TableState;
  endpoint?: string;
  /** 선택 열을 숨긴다. 선택이 없으면 재발송 막대도 나타나지 않는다. */
  readOnly?: boolean;
}) {
  const { filters, sort, pageSize, page, selectedIds } = state;
  const scrollRef = useRef<HTMLDivElement>(null);

  const request = useMemo<PageRequest>(
    () => ({
      scope,
      campaignId,
      status: filters.status,
      q: filters.q,
      sort,
      pageSize,
    }),
    [scope, campaignId, filters.status, filters.q, sort, pageSize],
  );

  // 전체 건수는 페이지와 별도로 한 번만 센다. 어느 페이지로 바로 들어와도 스크롤 길이를 알아야 한다.
  const totalQuery = useQuery({
    queryKey: messageKeys.total(request),
    queryFn: ({ signal }) =>
      fetchMessages(endpoint, buildSearchParams(request, 0, 1, true), signal),
  });
  const total = totalQuery.data?.total ?? 0;

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const firstVisible = items[0]?.index ?? 0;
  const lastVisible = items[items.length - 1]?.index ?? -1;

  const visiblePages = useMemo(
    () => pagesForRange(firstVisible, lastVisible, pageSize),
    [firstVisible, lastVisible, pageSize],
  );

  const [requestedPages, setRequestedPages] = useState<number[]>([page]);
  const visibleKey = visiblePages.join(",");
  useEffect(() => {
    if (visiblePages.length === 0) return;
    const timer = setTimeout(
      () => setRequestedPages(visiblePages),
      FETCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // visiblePages는 내용이 같아도 새 배열일 수 있어 내용으로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const pageQueries = useQueries({
    queries: requestedPages.map((pageNumber) => ({
      queryKey: messageKeys.page(request, pageNumber),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchMessages(
          endpoint,
          buildSearchParams(
            request,
            (pageNumber - 1) * pageSize,
            pageSize,
            false,
          ),
          signal,
        ),
    })),
  });

  const dataVersion = pageQueries.map((query) => query.dataUpdatedAt).join(",");

  // 전체 행 번호 → 행. 보이는 페이지의 행만 들어 있다.
  const { rowByIndex, loadedRows } = useMemo(() => {
    const byIndex = new Map<number, MessageRow>();
    const loaded: MessageRow[] = [];
    pageQueries.forEach((query, position) => {
      const pageNumber = requestedPages[position];
      if (!query.data || pageNumber === undefined) return;
      query.data.rows.forEach((row, offset) => {
        byIndex.set((pageNumber - 1) * pageSize + offset, row);
        loaded.push(row);
      });
    });
    return { rowByIndex: byIndex, loadedRows: loaded };
    // useQueries 결과는 렌더마다 새 배열이라 각 쿼리의 갱신 시각으로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, requestedPages, pageSize]);

  // 현재 페이지 전체 선택의 대상. 화면에 받아 둔 행 중 현재 페이지에 속한 것만이다.
  const currentPageIds = useMemo(() => {
    const start = (page - 1) * pageSize;
    const ids: number[] = [];
    for (let index = start; index < start + pageSize; index += 1) {
      const row = rowByIndex.get(index);
      if (row) ids.push(row.id);
    }
    return ids;
  }, [rowByIndex, page, pageSize]);

  const { setPage, toggleRow, togglePage, toggleSort } = state;

  const columns = useMemo<DataTableColumn<MessageRow>[]>(
    () => [
      ...(readOnly
        ? []
        : [
            column.display({
              id: "select",
              meta: { width: "44px" },
              header: () => (
                <PageCheckbox
                  ids={currentPageIds}
                  selectedIds={selectedIds}
                  onToggle={() => togglePage(currentPageIds)}
                />
              ),
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  aria-label={`${formatPhone(row.original.phone)} 선택`}
                  checked={selectedIds.has(row.original.id)}
                  onChange={() => toggleRow(row.original.id)}
                  tabIndex={-1}
                  className="size-4 cursor-pointer accent-primary"
                />
              ),
            }),
          ]),
      column.display({
        id: "phone",
        header: "수신 번호",
        meta: { width: "132px" },
        cell: ({ row }) => (
          <span className="text-mono">{formatPhone(row.original.phone)}</span>
        ),
      }),
      column.display({
        id: "name",
        header: "이름",
        meta: { width: "80px" },
        cell: ({ row }) => (
          <span className="truncate">{row.original.recipientName}</span>
        ),
      }),
      column.display({
        id: "status",
        header: "상태",
        meta: { width: "92px" },
        cell: ({ row }) => (
          <StatusBadge {...MESSAGE_STATUS_VIEW[row.original.status]} />
        ),
      }),
      column.display({
        id: "sentAt",
        meta: { width: "84px" },
        header: () => (
          <SortHeader
            label="접수 시각"
            column="sent_at"
            sort={sort}
            onToggle={toggleSort}
          />
        ),
        cell: ({ row }) =>
          row.original.sentAt ? formatKstTime(row.original.sentAt) : "—",
      }),
      column.display({
        id: "finalizedAt",
        meta: { width: "84px" },
        header: () => (
          <SortHeader
            label="확정 시각"
            column="finalized_at"
            sort={sort}
            onToggle={toggleSort}
          />
        ),
        cell: ({ row }) => {
          if (row.original.finalizedAt) {
            return formatKstTime(row.original.finalizedAt);
          }
          return row.original.status === "sent" ? (
            <span className="font-bold text-status-sent">확인 중</span>
          ) : (
            "—"
          );
        },
      }),
      column.display({
        id: "fail",
        header: "실패 코드·사유",
        meta: { width: "minmax(0, 1fr)" },
        cell: ({ row }) =>
          row.original.failCode ? (
            <span className="truncate">
              <span className="text-mono font-bold">
                {row.original.failCode}
              </span>{" "}
              {failReason(row.original.failCode)}
            </span>
          ) : null,
      }),
      column.display({
        id: "attempts",
        header: "시도",
        meta: { width: "52px", align: "right" },
        cell: ({ row }) => row.original.attemptCount,
      }),
    ],
    [
      readOnly,
      currentPageIds,
      selectedIds,
      sort,
      toggleRow,
      togglePage,
      toggleSort,
    ],
  );

  // 공유 링크로 뒤쪽 페이지에 들어오면 전체 건수를 안 뒤에 그 위치로 스크롤한다.
  // 아래 동기화보다 먼저 실행해야 한다. 반대면 스크롤이 맨 위인 상태로 page를 1로 덮어쓴다.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || total === 0) return;
    restoredRef.current = true;
    if (page > 1) jumpToPage(page);
    // 처음 한 번만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // 스크롤이 페이지 경계를 넘으면 주소의 page를 맞춘다. 새로고침이나 공유 링크가 같은 위치로 돌아온다.
  const scrolledPage = pageOfIndex(
    Math.min(
      Math.floor((virtualizer.scrollOffset ?? 0) / ROW_HEIGHT),
      Math.max(0, total - 1),
    ),
    pageSize,
  );
  const jumpingRef = useRef(false);
  useEffect(() => {
    if (jumpingRef.current || total === 0) return;
    if (scrolledPage !== page) setPage(scrolledPage);
    // page를 넣으면 버튼으로 이동할 때 스크롤보다 먼저 되돌아간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrolledPage, total]);

  function jumpToPage(target: number) {
    jumpingRef.current = true;
    setPage(target);
    virtualizer.scrollToOffset((target - 1) * pageSize * ROW_HEIGHT);
    // 스크롤 이벤트가 끝난 뒤에 스크롤 → page 동기화를 다시 켠다.
    setTimeout(() => {
      jumpingRef.current = false;
    }, 200);
  }

  // 조건이 바뀌면 page가 1로 돌아가므로 스크롤도 맨 위로 맞춘다.
  const conditionKey = JSON.stringify([
    campaignId,
    filters.status,
    filters.q,
    sort,
    pageSize,
  ]);
  const previousCondition = useRef(conditionKey);
  useEffect(() => {
    if (previousCondition.current === conditionKey) return;
    previousCondition.current = conditionKey;
    setRequestedPages([1]);
    virtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionKey]);

  // 측정 1의 기준점. 첫 행이 실제로 그려진 뒤 표시를 남긴다(scripts/measure-table.mjs).
  const firstPaintRef = useRef(false);
  // 전체 건수를 알기 전에는 행을 그리지 않으므로 둘 다 있어야 실제로 보이는 시점이다.
  const hasVisibleRow = total > 0 && rowByIndex.has(firstVisible);
  useEffect(() => {
    performance.mark("table:fetch-start");
  }, []);
  useEffect(() => {
    if (firstPaintRef.current || !hasVisibleRow) return;
    firstPaintRef.current = true;
    performance.mark("table:fetch-end");
    requestAnimationFrame(() => {
      setTimeout(() => {
        performance.mark("table:painted");
        document.documentElement.dataset.tableReady = String(total);
      }, 0);
    });
  }, [hasVisibleRow, total]);

  // 키보드: 포커스한 행에서 ↑↓로 이동하고 Space로 선택한다.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  useEffect(() => {
    if (focusIndex === null) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`)
      ?.focus();
  }, [focusIndex, loadedRows, firstVisible]);

  const hasError =
    totalQuery.isError || pageQueries.some((query) => query.isError);
  const isCounting = totalQuery.isPending;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  // 위치 표시는 스크롤 비율에 맞춰 세로로 움직인다(핸드오프).
  const scrollable = Math.max(1, total * ROW_HEIGHT - VIEWPORT_HEIGHT);
  const positionRatio = Math.min(
    1,
    (virtualizer.scrollOffset ?? 0) / scrollable,
  );

  if (hasError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 p-12 text-center"
      >
        <p className="text-body-sm text-text-muted">
          수신자 결과를 불러오지 못했어요
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void totalQuery.refetch();
            for (const query of pageQueries) void query.refetch();
          }}
        >
          다시 시도
        </Button>
      </div>
    );
  }

  if (!isCounting && total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-body-sm text-text-muted">
          {filters.q || filters.status.length > 0
            ? "조건에 맞는 수신자가 없어요"
            : "아직 수신자 결과가 없어요"}
        </p>
        {(filters.q || filters.status.length > 0) && (
          <Button
            variant="secondary"
            onClick={() => state.setFilters({ q: "", status: [] })}
          >
            수신자 조건 지우기
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <DataTable
        ariaLabel="수신자별 결과"
        columns={columns}
        rows={loadedRows}
        getRowId={(row) => String(row.id)}
        rowHeight={ROW_HEIGHT}
        scrollRef={scrollRef}
        virtual={{
          virtualizer,
          height: VIEWPORT_HEIGHT,
          rowAt: (index) => rowByIndex.get(index),
        }}
        getRowProps={(row, index) => {
          const selected = selectedIds.has(row.id);
          const failed = row.status === "failed";
          return {
            tabIndex: index === (focusIndex ?? firstVisible) ? 0 : -1,
            "aria-selected": selected,
            onFocus: () => setFocusIndex(index),
            onKeyDown: (event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, total - 1)
                    : Math.max(index - 1, 0);
                virtualizer.scrollToIndex(next);
                setFocusIndex(next);
              } else if (event.key === " ") {
                event.preventDefault();
                toggleRow(row.id);
              }
            },
            className: cn(
              failed && "bg-danger-subtle",
              selected && !failed && "bg-primary-subtle",
              selected && "shadow-[inset_3px_0_0_var(--primary)]",
            ),
          };
        }}
      >
        {total > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-16 z-20 rounded-full bg-surface px-2 py-0.5 text-mono shadow-floating"
            style={{ top: 44 + positionRatio * (VIEWPORT_HEIGHT - 76) }}
          >
            {(firstVisible + 1).toLocaleString("ko-KR")} /{" "}
            {total.toLocaleString("ko-KR")}
          </div>
        )}
      </DataTable>

      {selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="선택한 수신자"
          className="sticky bottom-4 z-30 mx-auto my-3 flex w-fit items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 shadow-floating"
        >
          <span className="text-body-sm font-bold">
            {selectedIds.size.toLocaleString("ko-KR")}건 선택
          </span>
          <RetryBar scope={scope} campaignId={campaignId} state={state} />
          <Button variant="ghost" onClick={state.clearSelection}>
            선택 해제
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border p-3">
        <Segmented
          label="페이지 크기"
          value={pageSize}
          options={PAGE_SIZES.map((size) => ({
            value: size,
            label: String(size),
          }))}
          onChange={state.setPageSize}
        />
        <span
          className="ml-auto text-body-sm text-text-muted"
          aria-live="polite"
        >
          {isCounting
            ? "건수 확인 중"
            : `${rangeStart.toLocaleString("ko-KR")}–${rangeEnd.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}건`}
        </span>
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => jumpToPage(page - 1)}
        >
          이전
        </Button>
        <Button
          variant="secondary"
          disabled={page >= lastPage}
          onClick={() => jumpToPage(page + 1)}
        >
          다음
        </Button>
      </div>
    </>
  );
}
