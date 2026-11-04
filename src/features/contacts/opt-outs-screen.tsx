"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { removeOptOut } from "./actions";
import { OptOutDialog } from "./contact-dialogs";
import {
  OPT_OUT_PAGE_SIZE,
  type OptOutFilters,
  type OptOutRow,
} from "./contact-query";
import { PageLink } from "./contacts-screen";

const column = createColumnHelper<typeof dataTableFeatures, OptOutRow>();

const SOURCE_LABEL: Record<string, string> = {
  manual: "직접 등록",
  upload: "엑셀 업로드",
  webhook: "수신거부 전화",
};

function buildColumns(canRemove: boolean): DataTableColumn<OptOutRow>[] {
  const columns: DataTableColumn<OptOutRow>[] = [
    column.display({
      id: "phone",
      header: "전화번호",
      meta: { width: "148px" },
      cell: ({ row }) => (
        <span className="text-mono">{formatPhone(row.original.phone)}</span>
      ),
    }),
    column.display({
      id: "reason",
      header: "사유",
      meta: { width: "minmax(160px, 1fr)" },
      cell: ({ row }) => (
        <span className="truncate">{row.original.reason ?? "—"}</span>
      ),
    }),
    column.display({
      id: "source",
      header: "등록 경로",
      meta: { width: "112px" },
      cell: ({ row }) =>
        SOURCE_LABEL[row.original.source] ?? row.original.source,
    }),
    column.display({
      id: "createdAt",
      header: "등록 시각",
      meta: { width: "148px" },
      cell: ({ row }) => formatKstDateTime(row.original.createdAt),
    }),
  ];
  if (canRemove) {
    columns.push(
      column.display({
        id: "actions",
        header: () => <span className="sr-only">작업</span>,
        meta: { width: "84px", align: "right" },
        cell: ({ row }) => (
          <ConfirmDialog
            title="수신거부를 해제할까요?"
            description={`${formatPhone(row.original.phone)} 번호로 다시 문자가 나갈 수 있어요. 수신자가 다시 동의한 경우에만 해제해 주세요.`}
            confirmLabel="해제"
            onConfirm={() => removeOptOut(row.original.id)}
            trigger={(open) => (
              <Button variant="ghost" onClick={open}>
                해제
              </Button>
            )}
          />
        ),
      }),
    );
  }
  return columns;
}

export function OptOutsScreen({
  rows,
  total,
  filters,
  canRemove,
}: {
  rows: OptOutRow[];
  total: number;
  filters: OptOutFilters;
  canRemove: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(filters.q);
  const columns = useMemo(() => buildColumns(canRemove), [canRemove]);

  function hrefWith(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => {
      router.replace(hrefWith({ q: search || null, page: null }), {
        scroll: false,
      });
    }, 300);
    return () => clearTimeout(timer);
    // hrefWith는 매 렌더 새로 만들어져 넣으면 타이머가 계속 다시 시작된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters.q]);

  const lastPage = Math.max(1, Math.ceil(total / OPT_OUT_PAGE_SIZE));
  const start = total === 0 ? 0 : (filters.page - 1) * OPT_OUT_PAGE_SIZE + 1;
  const end = Math.min(filters.page * OPT_OUT_PAGE_SIZE, total);

  return (
    <>
      <section
        aria-label="수신거부 검색"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <Input
          type="search"
          inputMode="numeric"
          aria-label="수신거부 번호 검색"
          placeholder="번호 검색"
          className="w-[220px]"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="ml-auto">
          <OptOutDialog
            trigger={(open) => <Button onClick={open}>수신거부 등록</Button>}
          />
        </div>
      </section>

      <section
        aria-label="수신거부 목록"
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        {rows.length === 0 ? (
          <p className="p-12 text-center text-body-sm text-text-muted">
            {filters.q
              ? "조건에 맞는 번호가 없어요"
              : "아직 수신거부한 번호가 없어요"}
          </p>
        ) : (
          <>
            <DataTable
              ariaLabel="수신거부"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.id}
              rowHeight={44}
            />
            <div className="flex items-center justify-end gap-3 border-t border-border p-3">
              <span className="text-body-sm text-text-muted">
                {start.toLocaleString("ko-KR")}–{end.toLocaleString("ko-KR")} /{" "}
                {total.toLocaleString("ko-KR")}건
              </span>
              <PageLink
                href={hrefWith({ page: String(filters.page - 1) })}
                disabled={filters.page <= 1}
                label="이전"
              />
              <PageLink
                href={hrefWith({ page: String(filters.page + 1) })}
                disabled={filters.page >= lastPage}
                label="다음"
              />
            </div>
          </>
        )}
      </section>
    </>
  );
}
