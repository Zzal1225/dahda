"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Store } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { formatWon, isLowBalance } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BranchAccountDialog, BranchNameDialog } from "./branch-dialogs";
import type { BranchRow } from "./branch-rows";

const column = createColumnHelper<typeof dataTableFeatures, BranchRow>();

function buildColumns(isTrial: boolean): DataTableColumn<BranchRow>[] {
  return [
    column.display({
      id: "name",
      header: "지점",
      meta: { width: "minmax(120px, 1fr)" },
      cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
    }),
    column.display({
      id: "account",
      header: "담당 계정",
      meta: { width: "minmax(120px, 1fr)" },
      cell: ({ row }) =>
        row.original.accountName ?? (
          <span className="text-text-muted">미지정</span>
        ),
    }),
    column.display({
      id: "balance",
      header: "잔액",
      meta: { width: "minmax(160px, 1fr)", align: "right" },
      cell: ({ row }) => {
        const low = isLowBalance(row.original.balance);
        return (
          <span className={cn(low && "font-bold text-status-pending")}>
            {low && <span className="mr-2 text-caption">잔액 적음</span>}
            {formatWon(row.original.balance)}
          </span>
        );
      },
    }),
    column.display({
      id: "actions",
      header: () => <span className="sr-only">작업</span>,
      meta: { width: "200px", align: "right" },
      cell: ({ row }) => (
        <>
          <BranchNameDialog
            branch={row.original}
            trigger={(open) => (
              <Button variant="ghost" onClick={open}>
                이름 변경
              </Button>
            )}
          />
          {/* 체험 계정은 실제 계정을 만들 수 없다. 서버도 막지만 누르면 실패할 버튼은 보여 주지 않는다. */}
          {!isTrial && !row.original.accountName && (
            <BranchAccountDialog branch={row.original} />
          )}
        </>
      ),
    }),
  ];
}

export function BranchList({
  rows,
  isTrial,
}: {
  rows: readonly BranchRow[];
  isTrial: boolean;
}) {
  const columns = useMemo(() => buildColumns(isTrial), [isTrial]);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-title-lg">지점 관리</h1>
          <p className="text-body-sm text-text-muted">
            잔액은 조회만 할 수 있어요. 충전은 지점에서 직접 해요.
          </p>
        </div>
        <BranchNameDialog
          trigger={(open) => <Button onClick={open}>지점 추가</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center">
          <Store
            aria-hidden
            className="size-6 text-text-muted"
            strokeWidth={1.75}
          />
          <p className="text-body-sm text-text-muted">아직 지점이 없어요</p>
          <BranchNameDialog
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                첫 지점 추가하기
              </Button>
            )}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <DataTable
            ariaLabel="지점"
            columns={columns}
            rows={[...rows]}
            getRowId={(row) => row.id}
            rowHeight={44}
          />
        </div>
      )}
    </>
  );
}
