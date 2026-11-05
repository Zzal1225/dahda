"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  campaignStatusView,
  campaignTitle,
  type CampaignRow,
} from "@/features/campaigns/campaign-view";
import { formatKstDateTime } from "@/lib/kst";

const column = createColumnHelper<typeof dataTableFeatures, CampaignRow>();

function buildColumns(showBranch: boolean): DataTableColumn<CampaignRow>[] {
  return [
    column.display({
      id: "when",
      header: "보낸 시각",
      meta: { width: "148px" },
      cell: ({ row }) => formatKstDateTime(row.original.displayAt),
    }),
    ...(showBranch
      ? [
          column.display({
            id: "branch",
            header: "지점",
            meta: { width: "72px" },
            cell: ({ row }) => row.original.branchName ?? "본사",
          }),
        ]
      : []),
    column.display({
      id: "title",
      header: "제목",
      meta: { width: "minmax(160px, 1fr)" },
      cell: ({ row }) => (
        <span className="truncate">
          {campaignTitle(row.original.body, row.original.isAd, 40)}
        </span>
      ),
    }),
    column.display({
      id: "recipients",
      header: "수신자",
      meta: { width: "96px", align: "right" },
      cell: ({ row }) =>
        `${row.original.recipientCount.toLocaleString("ko-KR")}명`,
    }),
    column.display({
      id: "status",
      header: "상태",
      meta: { width: "112px" },
      cell: ({ row }) => <StatusBadge {...campaignStatusView(row.original)} />,
    }),
  ];
}

export function RecentTable({
  rows,
  showBranch,
}: {
  rows: CampaignRow[];
  showBranch: boolean;
}) {
  const columns = useMemo(() => buildColumns(showBranch), [showBranch]);
  return (
    <DataTable
      ariaLabel="최근 발송"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      rowHeight={44}
    />
  );
}
