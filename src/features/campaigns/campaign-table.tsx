"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWon } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { cn } from "@/lib/utils";
import {
  campaignCost,
  campaignStatusView,
  campaignTitle,
  messageCounts,
  progressText,
  type CampaignRow,
} from "./campaign-view";

const column = createColumnHelper<typeof dataTableFeatures, CampaignRow>();

function buildColumns(showBranch: boolean): DataTableColumn<CampaignRow>[] {
  const columns: DataTableColumn<CampaignRow>[] = [
    column.display({
      id: "when",
      header: "보낸 시각",
      meta: { width: "148px" },
      cell: ({ row }) => formatKstDateTime(row.original.displayAt),
    }),
    column.display({
      id: "title",
      header: "제목",
      meta: { width: "minmax(180px, 1fr)" },
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {row.original.retryOfCampaignId && (
            <span className="flex-none rounded-sm border border-border-strong px-1 text-caption">
              재발송
            </span>
          )}
          <span className="truncate">
            {campaignTitle(row.original.body, row.original.isAd)}
          </span>
        </span>
      ),
    }),
    column.display({
      id: "kind",
      header: "종류",
      meta: { width: "52px" },
      cell: ({ row }) => (
        <span className="text-mono">{row.original.kind.toUpperCase()}</span>
      ),
    }),
    column.display({
      id: "ad",
      header: "광고",
      meta: { width: "52px" },
      cell: ({ row }) =>
        row.original.isAd ? (
          <span className="rounded-sm border border-border-strong px-1 text-caption">
            광고
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    }),
    column.display({
      id: "recipients",
      header: "수신자",
      meta: { width: "76px", align: "right" },
      cell: ({ row }) => row.original.recipientCount.toLocaleString("ko-KR"),
    }),
    column.display({
      id: "progress",
      header: "진행률",
      meta: { width: "140px" },
      cell: ({ row }) => (
        <div className="flex w-full flex-col gap-1">
          {/* 보내기 전에는 빈 막대가 0%로 읽혀 실패처럼 보이므로 글자만 둔다. */}
          {row.original.sentCount > 0 && (
            <ProgressBar
              counts={messageCounts(row.original)}
              total={row.original.recipientCount}
            />
          )}
          <span className="text-caption text-text-muted">
            {progressText(row.original)}
          </span>
        </div>
      ),
    }),
    column.display({
      id: "status",
      header: "상태",
      meta: { width: "96px" },
      cell: ({ row }) => <StatusBadge {...campaignStatusView(row.original)} />,
    }),
    column.display({
      id: "cost",
      header: "비용",
      meta: { width: "112px", align: "right" },
      cell: ({ row }) => {
        const cost = campaignCost(row.original);
        return cost.estimated ? (
          <span className="text-text-muted">예상 {formatWon(cost.amount)}</span>
        ) : (
          formatWon(cost.amount)
        );
      },
    }),
  ];

  if (showBranch) {
    columns.splice(
      1,
      0,
      column.display({
        id: "branch",
        header: "지점",
        meta: { width: "64px" },
        cell: ({ row }) => row.original.branchName ?? "본사",
      }),
    );
  }
  return columns;
}

export function CampaignTable({
  campaigns,
  selectedId,
  showBranch,
  onSelect,
}: {
  campaigns: CampaignRow[];
  selectedId: string | null;
  showBranch: boolean;
  onSelect: (id: string) => void;
}) {
  const columns = useMemo(() => buildColumns(showBranch), [showBranch]);

  return (
    <DataTable
      ariaLabel="발송 건"
      columns={columns}
      rows={campaigns}
      getRowId={(campaign) => campaign.id}
      rowHeight={44}
      getRowProps={(campaign) => {
        const selected = campaign.id === selectedId;
        return {
          tabIndex: 0,
          "aria-selected": selected,
          onClick: () => onSelect(campaign.id),
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(campaign.id);
            }
          },
          className: cn(
            "cursor-pointer last:border-b-0",
            selected ? "bg-primary-subtle font-bold" : "hover:bg-surface-2",
          ),
        };
      }}
    />
  );
}
