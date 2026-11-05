"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWon } from "@/lib/format";

type SampleRow = {
  id: string;
  title: string;
  recipients: number;
  cost: number;
};

const column = createColumnHelper<typeof dataTableFeatures, SampleRow>();
const COLUMNS: DataTableColumn<SampleRow>[] = [
  column.display({
    id: "title",
    header: "제목",
    meta: { width: "minmax(160px, 1fr)" },
    cell: ({ row }) => row.original.title,
  }),
  column.display({
    id: "recipients",
    header: "수신자",
    meta: { width: "96px", align: "right" },
    cell: ({ row }) => `${row.original.recipients.toLocaleString("ko-KR")}명`,
  }),
  column.display({
    id: "status",
    header: "상태",
    meta: { width: "112px" },
    cell: () => <StatusBadge tone="delivered" label="완료" />,
  }),
  column.display({
    id: "cost",
    header: "비용",
    meta: { width: "112px", align: "right" },
    cell: ({ row }) => formatWon(row.original.cost),
  }),
];
const ROWS: SampleRow[] = [
  { id: "1", title: "샘플 안내 문자", recipients: 1240, cost: 24_800 },
  { id: "2", title: "샘플 입고 안내", recipients: 320, cost: 6_400 },
];

const PERIODS = [
  { value: "today", label: "오늘" },
  { value: "7d", label: "7일" },
  { value: "30d", label: "30일" },
] as const;

/** 설명용 사본을 만들지 않고 실제 컴포넌트를 그린다. 사본은 화면과 어긋나도 알 수 없다. */
export function InteractiveSamples() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("7d");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button>기본</Button>
        <Button variant="secondary">보조</Button>
        <Button variant="ghost">약한 버튼</Button>
        <Button variant="danger">위험</Button>
        <Button disabled>비활성</Button>
      </div>

      <div className="flex max-w-[320px] flex-col gap-2">
        <label htmlFor="sample-input" className="text-body-sm font-bold">
          입력
        </label>
        <Input id="sample-input" placeholder="값을 입력해 주세요" />
        <Input aria-label="비활성 입력" placeholder="비활성" disabled />
      </div>

      <div>
        <Segmented
          label="기간 샘플"
          value={period}
          options={PERIODS}
          onChange={setPeriod}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ConfirmDialog
          title="이 동작을 진행할까요?"
          description="되돌리기 어려운 동작은 이렇게 한 번 더 확인해요."
          confirmLabel="진행"
          onConfirm={async () => {
            setConfirmed(true);
            return undefined;
          }}
          trigger={(open) => (
            <Button variant="secondary" onClick={open}>
              확인 대화상자 열기
            </Button>
          )}
        />
        {confirmed && (
          <span role="status" className="text-body-sm text-text-muted">
            진행했어요
          </span>
        )}
      </div>

      <DataTable
        ariaLabel="표 샘플"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        rowHeight={44}
      />
    </>
  );
}
