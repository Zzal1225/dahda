"use client";

import {
  FlexRender,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * 표는 이 컴포넌트 하나다(CLAUDE.md). 화면마다 열 정의와 행 속성만 다르다.
 *
 * <table> 대신 div + ARIA 역할을 쓴다. 가상화에는 행을 절대 위치로 놓아야 하는데 <tr>에는 쓸 수 없고,
 * 일반 표와 가상 표가 같은 마크업이어야 스타일과 테스트를 하나로 유지할 수 있다.
 */
export const dataTableFeatures = tableFeatures({
  columnMeta: {} as { width: string; align?: "left" | "right" },
});
type Features = typeof dataTableFeatures;
export type DataTableColumn<TData extends RowData> = ColumnDef<Features, TData>;

export type DataTableVirtual<TData extends RowData> = {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  height: number;
  /** 전체 행 번호로 행을 찾는다. 아직 받지 못한 행은 undefined이고 자리 표시를 그린다. */
  rowAt: (index: number) => TData | undefined;
};

type RowProps = HTMLAttributes<HTMLDivElement>;

export function DataTable<TData extends RowData>({
  ariaLabel,
  columns,
  rows,
  getRowId,
  rowHeight,
  getRowProps,
  virtual,
  scrollRef,
  children,
}: {
  ariaLabel: string;
  columns: DataTableColumn<TData>[];
  /** 가상 표에서는 받아 둔 행만 넘긴다. 10만 행 모델을 만들면 가상화 효과가 사라진다. */
  rows: TData[];
  getRowId: (row: TData) => string;
  rowHeight: number;
  getRowProps?: (row: TData, index: number) => RowProps;
  virtual?: DataTableVirtual<TData>;
  /** 가상 표의 스크롤 영역. virtual 객체에 넣으면 렌더 중 ref 접근으로 판정되어 따로 받는다. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** 스크롤 영역 위에 띄우는 요소(위치 표시 등) */
  children?: ReactNode;
}) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId,
  });

  const template = columns
    .map((column) => column.meta?.width ?? "1fr")
    .join(" ");
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const rowsById = table.getRowModel().rowsById;

  function renderCells(row: TData) {
    const tableRow = rowsById[getRowId(row)];
    return tableRow?.getAllCells().map((cell) => (
      <div
        key={cell.id}
        role="cell"
        className={cn(
          "flex min-w-0 items-center overflow-hidden px-2 whitespace-nowrap first:pl-4 last:pr-4",
          cell.column.columnDef.meta?.align === "right" && "justify-end",
        )}
      >
        <FlexRender cell={cell} />
      </div>
    ));
  }

  function renderRow(row: TData, index: number, style: RowProps["style"]) {
    const {
      className,
      style: rowStyle,
      ...rowProps
    } = getRowProps?.(row, index) ?? {};
    return (
      <div
        key={getRowId(row)}
        role="row"
        data-row
        data-index={index}
        aria-rowindex={index + 2}
        style={{
          gridTemplateColumns: template,
          height: rowHeight,
          ...style,
          ...rowStyle,
        }}
        className={cn(
          "grid border-b border-border text-body-sm outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]",
          className,
        )}
        {...rowProps}
      >
        {renderCells(row)}
      </div>
    );
  }

  const header = (
    <div role="rowgroup" className="sticky top-0 z-10 bg-surface-2">
      <div
        role="row"
        aria-rowindex={1}
        className="grid h-(--row-dense) border-b border-border text-caption font-bold text-text-muted"
        style={{ gridTemplateColumns: template }}
      >
        {headers.map((column) => (
          <div
            key={column.id}
            role="columnheader"
            className={cn(
              "flex min-w-0 items-center px-2 whitespace-nowrap first:pl-4 last:pr-4",
              column.column.columnDef.meta?.align === "right" && "justify-end",
            )}
          >
            <FlexRender header={column} />
          </div>
        ))}
      </div>
    </div>
  );

  if (!virtual) {
    return (
      <div
        role="table"
        aria-label={ariaLabel}
        aria-rowcount={rows.length + 1}
        className="overflow-x-auto"
      >
        {/* 좁은 화면에서 열이 찌그러지지 않게 내용 폭을 유지하고 가로로 스크롤한다. */}
        <div className="w-full min-w-fit">
          {header}
          <div role="rowgroup">
            {rows.map((row, index) => renderRow(row, index, undefined))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        data-table-scroller
        role="table"
        aria-label={ariaLabel}
        aria-rowcount={virtual.virtualizer.options.count + 1}
        style={{ height: virtual.height }}
        className="overflow-auto"
      >
        {header}
        <div
          role="rowgroup"
          className="relative w-full"
          style={{ height: virtual.virtualizer.getTotalSize() }}
        >
          {virtual.virtualizer.getVirtualItems().map((item) => {
            const position = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            } as const;
            const row = virtual.rowAt(item.index);
            if (row) return renderRow(row, item.index, position);
            return (
              <div
                key={`placeholder-${item.index}`}
                role="row"
                aria-busy
                aria-rowindex={item.index + 2}
                style={{ ...position, height: rowHeight }}
                className="flex items-center border-b border-border px-4"
              >
                <div className="h-3 w-full rounded-sm bg-skeleton" />
              </div>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
