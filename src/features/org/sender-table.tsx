"use client";

import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { formatPhone } from "@/lib/format";

export type SenderRow = {
  id: string;
  owner: string;
  label: string;
  number: string;
  isDefault: boolean;
};

const column = createColumnHelper<typeof dataTableFeatures, SenderRow>();

const COLUMNS: DataTableColumn<SenderRow>[] = [
  column.display({
    id: "owner",
    header: "계정",
    meta: { width: "112px" },
    cell: ({ row }) => row.original.owner,
  }),
  column.display({
    id: "label",
    header: "이름",
    meta: { width: "minmax(120px, 1fr)" },
    cell: ({ row }) => row.original.label,
  }),
  column.display({
    id: "number",
    header: "발신번호",
    meta: { width: "148px" },
    cell: ({ row }) => (
      <span className="text-mono">{formatPhone(row.original.number)}</span>
    ),
  }),
  column.display({
    id: "default",
    header: "대표",
    meta: { width: "72px" },
    cell: ({ row }) => (row.original.isDefault ? "대표" : ""),
  }),
];

export function SenderTable({ rows }: { rows: SenderRow[] }) {
  return (
    <DataTable
      ariaLabel="발신번호"
      columns={COLUMNS}
      rows={rows}
      getRowId={(row) => row.id}
      rowHeight={44}
    />
  );
}
