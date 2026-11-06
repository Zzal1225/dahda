"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { StickyNote } from "lucide-react";
import { useMemo } from "react";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { StatusChip } from "@/components/ui/status-chip";
import { Tooltip } from "@/components/ui/tooltip";
import { maskPhone } from "@/lib/format";
import { formatKstDate } from "@/lib/kst";
import type { ContactRow, GroupRow } from "./contact-query";
import { RECEIVE_STATUS_VIEW } from "./receive-status";

const column = createColumnHelper<typeof dataTableFeatures, ContactRow>();
const ROW_HEIGHT = 44;

/** 그룹 칩. 칸이 좁으면 뒤쪽 칩은 잘리고, 행을 눌러 상세에서 모두 본다. */
export function GroupChips({
  ids,
  nameOf,
  wrap = false,
}: {
  ids: readonly string[];
  nameOf: ReadonlyMap<string, string>;
  /** 상세처럼 칸이 넉넉하면 줄을 바꿔 모두 보인다. */
  wrap?: boolean;
}) {
  const names = ids.flatMap((id) => {
    const name = nameOf.get(id);
    return name ? [name] : [];
  });
  if (names.length === 0) {
    return <span className="text-text-disabled">—</span>;
  }
  return (
    <span
      className={
        wrap
          ? "flex min-w-0 flex-wrap gap-1"
          : "flex min-w-0 gap-1 overflow-hidden"
      }
    >
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex h-6 flex-none items-center rounded-full border border-border bg-surface-2 px-2 text-caption"
        >
          {name}
        </span>
      ))}
    </span>
  );
}

function PageCheckbox({
  ids,
  selectedIds,
  onToggle,
}: {
  ids: readonly string[];
  selectedIds: ReadonlySet<string>;
  onToggle: () => void;
}) {
  const count = ids.filter((id) => selectedIds.has(id)).length;
  const all = ids.length > 0 && count === ids.length;
  return (
    <input
      type="checkbox"
      aria-label="이 페이지 전체 선택"
      checked={all}
      ref={(element) => {
        if (element) element.indeterminate = count > 0 && !all;
      }}
      onChange={onToggle}
      className="size-4 cursor-pointer accent-primary"
    />
  );
}

/**
 * 주소록 표. 번호는 가려서 보여 준다(maskPhone). 행을 누르면 상세(드로어)가 열리고 거기서 전체 번호를 본다.
 * 체크박스·메모 아이콘은 행 클릭으로 번지지 않게 막는다. 고르려다 상세가 열리면 선택이 끊긴다.
 */
export function ContactTable({
  rows,
  groups,
  showBranch,
  selectedIds,
  onToggle,
  onTogglePage,
  onOpen,
}: {
  rows: ContactRow[];
  groups: readonly GroupRow[];
  showBranch: boolean;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onTogglePage: (ids: readonly string[]) => void;
  onOpen: (contact: ContactRow) => void;
}) {
  const nameOf = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );
  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const columns = useMemo<DataTableColumn<ContactRow>[]>(() => {
    const list: DataTableColumn<ContactRow>[] = [
      column.display({
        id: "select",
        meta: { width: "44px" },
        header: () => (
          <PageCheckbox
            ids={pageIds}
            selectedIds={selectedIds}
            onToggle={() => onTogglePage(pageIds)}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`${row.original.name ?? "이름 없음"} 선택`}
            checked={selectedIds.has(row.original.id)}
            onChange={() => onToggle(row.original.id)}
            onClick={(event) => event.stopPropagation()}
            className="size-4 cursor-pointer accent-primary"
          />
        ),
      }),
      column.display({
        id: "name",
        header: "이름",
        meta: { width: "minmax(112px, 1fr)" },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-bold">
              {row.original.name ?? "이름 없음"}
            </span>
            {row.original.memo && (
              <Tooltip content={row.original.memo}>
                <button
                  type="button"
                  aria-label={`메모: ${row.original.memo}`}
                  onClick={(event) => event.stopPropagation()}
                  className="flex size-5 flex-none cursor-default items-center justify-center rounded-sm text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <StickyNote
                    aria-hidden
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </button>
              </Tooltip>
            )}
          </span>
        ),
      }),
      column.display({
        id: "phone",
        header: "전화번호",
        meta: { width: "136px" },
        cell: ({ row }) => (
          <span className="text-mono tabular-nums">
            {maskPhone(row.original.phone)}
          </span>
        ),
      }),
    ];
    if (showBranch) {
      list.push(
        column.display({
          id: "branch",
          header: "지점",
          meta: { width: "80px" },
          cell: ({ row }) => row.original.branchName,
        }),
      );
    }
    list.push(
      column.display({
        id: "groups",
        header: "그룹",
        meta: { width: "minmax(160px, 2fr)" },
        cell: ({ row }) => (
          <GroupChips ids={row.original.groupIds} nameOf={nameOf} />
        ),
      }),
      column.display({
        id: "status",
        header: "수신 상태",
        meta: { width: "96px" },
        cell: ({ row }) => (
          <StatusChip {...RECEIVE_STATUS_VIEW[row.original.receiveStatus]} />
        ),
      }),
      column.display({
        id: "createdAt",
        header: "등록일",
        meta: { width: "104px" },
        cell: ({ row }) => (
          <span className="text-text-muted tabular-nums">
            {formatKstDate(row.original.createdAt)}
          </span>
        ),
      }),
    );
    return list;
  }, [showBranch, nameOf, pageIds, selectedIds, onToggle, onTogglePage]);

  return (
    <DataTable
      ariaLabel="연락처"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      rowHeight={ROW_HEIGHT}
      getRowProps={(row) => {
        const selected = selectedIds.has(row.id);
        return {
          tabIndex: 0,
          "aria-selected": selected,
          onClick: () => onOpen(row),
          onKeyDown: (event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onOpen(row);
            } else if (event.key === " ") {
              event.preventDefault();
              onToggle(row.id);
            }
          },
          className: selected
            ? "cursor-pointer bg-primary-subtle"
            : "cursor-pointer hover:bg-surface-2",
        };
      }}
    />
  );
}
