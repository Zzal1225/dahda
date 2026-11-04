"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, FileUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { checkUploadPhones, saveUploadBatch } from "./actions";
import { readUpload } from "./read-upload";
import {
  applyServerCheck,
  classifyRow,
  markFileDuplicates,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  summarize,
  type UploadRow,
} from "./upload-rows";

const CHECK_BATCH = 2_000;
const SAVE_BATCH = 500;
const ROW_HEIGHT = 44;
const TABLE_HEIGHT = 396;

type Phase =
  | { name: "idle"; error?: string }
  | { name: "parsing"; fileName: string }
  | { name: "checking"; fileName: string; done: number; total: number }
  | { name: "review"; fileName: string; error?: string }
  | { name: "saving"; fileName: string; done: number; total: number }
  | { name: "done"; inserted: number; skipped: number; error?: string };

const column = createColumnHelper<typeof dataTableFeatures, UploadRow>();

/** 전체 행을 서버 기준으로 다시 분류한다. 파일을 처음 읽을 때와 사용자가 고친 뒤에 같은 경로를 쓴다. */
async function checkOnServer(
  rows: readonly UploadRow[],
  onProgress: (done: number, total: number) => void,
): Promise<UploadRow[] | { error: string }> {
  // 앞 단계의 서버 표시를 지우고 다시 판단한다. 수신거부는 그사이 바뀌었을 수 있다.
  const local = markFileDuplicates(
    rows.map((row) =>
      classifyRow(row.rowNumber, row.phoneInput, row.name, row.memo),
    ),
  );
  const phones = local.flatMap((row) =>
    row.status === "ok" && row.phone ? [row.phone] : [],
  );

  const existing = new Set<string>();
  const optedOut = new Set<string>();
  for (let start = 0; start < phones.length; start += CHECK_BATCH) {
    onProgress(start, phones.length);
    const result = await checkUploadPhones(
      phones.slice(start, start + CHECK_BATCH),
    );
    if ("error" in result) return result;
    for (const phone of result.existing) existing.add(phone);
    for (const phone of result.optedOut) optedOut.add(phone);
  }
  return applyServerCheck(local, existing, optedOut);
}

function SummaryCard({
  label,
  count,
  emphasis,
}: {
  label: string;
  count: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-caption text-text-muted">{label}</span>
      <span
        className={
          emphasis ? "text-number-lg text-primary" : "text-number-lg text-text"
        }
      >
        {count.toLocaleString("ko-KR")}
      </span>
    </div>
  );
}

export function UploadScreen({
  groups,
}: {
  groups: readonly { id: string; name: string }[];
}) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [groupId, setGroupId] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => summarize(rows), [rows]);
  const problems = useMemo(
    () => rows.filter((row) => row.status !== "ok"),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: problems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  // 입력한 값은 부모 상태에 둔다. 가상 스크롤로 입력칸이 사라졌다 돌아와도 값이 남아야 한다.
  function editPhone(rowNumber: number, phoneInput: string) {
    setRows((current) =>
      current.map((row) =>
        row.rowNumber === rowNumber ? { ...row, phoneInput } : row,
      ),
    );
  }

  const columns = useMemo<DataTableColumn<UploadRow>[]>(
    () => [
      column.display({
        id: "rowNumber",
        header: "줄",
        meta: { width: "64px", align: "right" },
        cell: ({ row }) => row.original.rowNumber.toLocaleString("ko-KR"),
      }),
      column.display({
        id: "phone",
        header: "전화번호",
        meta: { width: "200px" },
        cell: ({ row }) =>
          row.original.status === "invalid" ? (
            <Input
              aria-label={`${row.original.rowNumber}번째 줄 전화번호`}
              value={row.original.phoneInput}
              onChange={(event) =>
                editPhone(row.original.rowNumber, event.target.value)
              }
              className="h-8"
            />
          ) : (
            <span className="text-mono">{row.original.phoneInput}</span>
          ),
      }),
      column.display({
        id: "name",
        header: "이름",
        meta: { width: "112px" },
        cell: ({ row }) => (
          <span className="truncate">{row.original.name ?? "—"}</span>
        ),
      }),
      column.display({
        id: "problem",
        header: "문제",
        meta: { width: "minmax(200px, 1fr)" },
        cell: ({ row }) => (
          <span
            className={
              row.original.status === "invalid"
                ? "truncate text-danger"
                : "truncate text-text-muted"
            }
          >
            {row.original.problem}
          </span>
        ),
      }),
    ],
    [],
  );

  async function handleFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhase({ name: "idle", error: "파일은 5MB까지 올릴 수 있어요" });
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setPhase({
        name: "idle",
        error: "엑셀(.xlsx, .xls) 또는 CSV 파일만 올릴 수 있어요",
      });
      return;
    }

    setPhase({ name: "parsing", fileName: file.name });
    performance.mark("upload:parse-start");
    const parsed = await readUpload(file);
    performance.mark("upload:parse-end");
    if (!parsed.ok) {
      setPhase({ name: "idle", error: parsed.error });
      return;
    }

    await runCheck(parsed.rows, file.name);
    // 측정 스크립트의 기준점이다(scripts/measure-upload.mjs).
    document.documentElement.dataset.uploadReady = String(parsed.rows.length);
  }

  async function runCheck(target: readonly UploadRow[], fileName: string) {
    setPhase({ name: "checking", fileName, done: 0, total: target.length });
    const checked = await checkOnServer(target, (done, total) =>
      setPhase({ name: "checking", fileName, done, total }),
    );
    if ("error" in checked) {
      setRows([...target]);
      setPhase({ name: "review", fileName, error: checked.error });
      return;
    }
    setRows(checked);
    setPhase({ name: "review", fileName });
  }

  async function save(fileName: string) {
    const valid = rows.filter((row) => row.status === "ok" && row.phone);
    setPhase({ name: "saving", fileName, done: 0, total: valid.length });

    let inserted = 0;
    for (let start = 0; start < valid.length; start += SAVE_BATCH) {
      const result = await saveUploadBatch({
        groupId: groupId || null,
        rows: valid.slice(start, start + SAVE_BATCH).map((row) => ({
          phone: row.phone,
          name: row.name,
          memo: row.memo,
        })),
      });
      if ("error" in result) {
        // 앞 묶음은 이미 저장되었다. 다시 올려도 중복으로 건너뛰므로 숫자를 알려 주고 멈춘다.
        setPhase({
          name: "done",
          inserted,
          skipped: 0,
          error: `${result.error}. ${inserted.toLocaleString("ko-KR")}명까지 저장했어요. 같은 파일을 다시 올리면 남은 번호만 저장돼요`,
        });
        return;
      }
      inserted += result.inserted;
      setPhase({
        name: "saving",
        fileName,
        done: Math.min(start + SAVE_BATCH, valid.length),
        total: valid.length,
      });
    }

    setPhase({
      name: "done",
      inserted,
      skipped: rows.length - valid.length,
    });
  }

  function reset() {
    setRows([]);
    setGroupId("");
    setPhase({ name: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  if (phase.name === "idle") {
    return (
      <section
        aria-label="파일 올리기"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={
          dragging
            ? "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary-subtle p-12 text-center"
            : "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border-strong bg-surface p-12 text-center"
        }
      >
        <FileUp
          aria-hidden
          className="size-8 text-text-muted"
          strokeWidth={1.5}
        />
        <p className="text-body">파일을 끌어다 놓거나 선택해 주세요</p>
        <p className="text-caption text-text-muted">
          엑셀(.xlsx, .xls), CSV · 5MB ·{" "}
          {MAX_UPLOAD_ROWS.toLocaleString("ko-KR")}행까지. 첫 줄에 전화번호,
          이름, 메모 머리글이 있어야 해요.
        </p>
        <p className="text-caption text-text-muted">
          수신 동의를 받은 번호만 올려 주세요.
        </p>
        <input
          ref={inputRef}
          type="file"
          aria-label="업로드할 파일"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button onClick={() => inputRef.current?.click()}>파일 선택</Button>
        {phase.error && (
          <p role="alert" className="text-body-sm text-danger">
            {phase.error}
          </p>
        )}
      </section>
    );
  }

  if (
    phase.name === "parsing" ||
    phase.name === "checking" ||
    phase.name === "saving"
  ) {
    const label =
      phase.name === "parsing"
        ? "파일을 읽는 중이에요"
        : phase.name === "checking"
          ? "주소록과 수신거부를 확인하는 중이에요"
          : "저장하는 중이에요";
    const progress =
      phase.name === "parsing"
        ? null
        : `${phase.done.toLocaleString("ko-KR")} / ${phase.total.toLocaleString("ko-KR")}`;
    return (
      <section
        aria-label="처리 중"
        aria-busy
        className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center"
      >
        <p role="status" className="text-body">
          {label}
        </p>
        <p className="text-caption text-text-muted">
          {phase.fileName}
          {progress && ` · ${progress}`}
        </p>
      </section>
    );
  }

  if (phase.name === "done") {
    return (
      <section
        aria-label="저장 결과"
        className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center"
      >
        <CircleCheck
          aria-hidden
          className="size-8 text-status-delivered"
          strokeWidth={1.5}
        />
        <p className="text-title">
          {phase.inserted.toLocaleString("ko-KR")}명을 저장했어요
        </p>
        {phase.skipped > 0 && (
          <p className="text-body-sm text-text-muted">
            문제가 있는 {phase.skipped.toLocaleString("ko-KR")}행은 저장하지
            않았어요
          </p>
        )}
        {phase.error && (
          <p role="alert" className="text-body-sm text-danger">
            {phase.error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset}>
            다른 파일 올리기
          </Button>
          <Link
            href="/contacts"
            className="inline-flex h-(--control-h) items-center rounded-md bg-primary px-4 text-body-sm font-bold text-primary-fg outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            주소록 보기
          </Link>
        </div>
      </section>
    );
  }

  const { fileName } = phase;
  const hasEditable = summary.invalid > 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="저장할 수 있어요" count={summary.ok} emphasis />
        <SummaryCard label="형식 오류" count={summary.invalid} />
        <SummaryCard label="중복" count={summary.duplicate} />
        <SummaryCard label="수신거부" count={summary.opted_out} />
      </div>

      {phase.error && (
        <p role="alert" className="text-body-sm text-danger">
          {phase.error}
        </p>
      )}

      {problems.length > 0 && (
        <section
          aria-label="확인이 필요한 행"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-title">확인이 필요한 행</h2>
              <p className="text-caption text-text-muted">
                형식 오류는 여기서 고칠 수 있어요. 중복과 수신거부는 저장하지
                않아요.
              </p>
            </div>
            {hasEditable && (
              <Button
                variant="secondary"
                onClick={() => void runCheck(rows, fileName)}
              >
                고친 내용 확인
              </Button>
            )}
          </div>
          <DataTable
            ariaLabel="확인이 필요한 행"
            columns={columns}
            rows={problems}
            getRowId={(row) => String(row.rowNumber)}
            rowHeight={ROW_HEIGHT}
            scrollRef={scrollRef}
            virtual={{
              virtualizer,
              height: Math.min(
                TABLE_HEIGHT,
                (problems.length + 1) * ROW_HEIGHT,
              ),
              rowAt: (index) => problems[index],
            }}
          />
        </section>
      )}

      <section
        aria-label="저장"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <span className="min-w-0 truncate text-body-sm text-text-muted">
          {fileName}
        </span>
        {groups.length > 0 && (
          <select
            aria-label="저장할 그룹"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">그룹 없이 저장</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={reset}>
            취소
          </Button>
          <Button
            disabled={summary.ok === 0}
            onClick={() => void save(fileName)}
          >
            {summary.ok.toLocaleString("ko-KR")}명 저장
          </Button>
        </div>
      </section>
    </>
  );
}
