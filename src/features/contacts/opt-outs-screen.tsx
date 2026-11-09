"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { maskPhone } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { removeOptOut } from "./actions";
import type { OptOutRow } from "./contact-query";

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
        <span className="text-mono tabular-nums">
          {maskPhone(row.original.phone)}
        </span>
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
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatKstDateTime(row.original.createdAt)}
        </span>
      ),
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
            description={`${maskPhone(row.original.phone)} 번호로 다시 문자가 나갈 수 있어요. 수신자가 다시 동의한 경우에만 해제해 주세요.`}
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

/**
 * 그룹 목록에서 "수신거부"를 고르면 오른쪽에 보이는 표. 본사 공통 목록이라 지점 필터와 관계없다.
 * 번호는 주소록 표처럼 가린다. 해제는 본사만 한다(다시 보내도 되는지 판단은 본사 책임).
 */
export function OptOutTable({
  rows,
  canRemove,
  filtered,
}: {
  rows: OptOutRow[];
  canRemove: boolean;
  filtered: boolean;
}) {
  const columns = useMemo(() => buildColumns(canRemove), [canRemove]);
  if (rows.length === 0) {
    return (
      <p className="p-12 text-center text-body-sm text-text-muted">
        {filtered
          ? "조건에 맞는 번호가 없어요"
          : "아직 수신거부한 번호가 없어요"}
      </p>
    );
  }
  return (
    <DataTable
      ariaLabel="수신거부"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      rowHeight={44}
    />
  );
}
