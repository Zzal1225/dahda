"use client";

import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { formatWon } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { cn } from "@/lib/utils";
import { ledgerKindLabel } from "./charge-schema";
import type { LedgerRow } from "./ledger-query";

const column = createColumnHelper<typeof dataTableFeatures, LedgerRow>();

const COLUMNS: DataTableColumn<LedgerRow>[] = [
  column.display({
    id: "createdAt",
    header: "시각",
    meta: { width: "160px" },
    cell: ({ row }) => formatKstDateTime(row.original.createdAt),
  }),
  column.display({
    id: "kind",
    header: "종류",
    meta: { width: "minmax(120px, 1fr)" },
    cell: ({ row }) => ledgerKindLabel(row.original.kind),
  }),
  column.display({
    id: "amount",
    header: "금액",
    meta: { width: "140px", align: "right" },
    cell: ({ row }) => {
      const { amount } = row.original;
      return (
        <span className={cn("font-bold", amount < 0 && "text-text-muted")}>
          {amount > 0 ? "+" : "−"}
          {formatWon(Math.abs(amount))}
        </span>
      );
    },
  }),
];

export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <DataTable
      ariaLabel="거래 내역"
      columns={COLUMNS}
      rows={rows}
      getRowId={(row) => row.id}
      rowHeight={44}
    />
  );
}
