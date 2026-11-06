"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { ArrowRight, CircleCheck, Download, FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import type { TableInfo } from "./parse.worker";
import { checkUploadPhones, saveUploadBatch } from "./actions";
import { UploadCanceledError, UploadSession } from "./read-upload";
import {
  applyServerCheck,
  COLUMN_FIELDS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  problemSheetRows,
  summarize,
  uploadSummaryText,
  type ColumnField,
  type ColumnMap,
  type UploadRow,
} from "./upload-rows";

const CHECK_BATCH = 2_000;
const SAVE_BATCH = 500;
const UNUSED = "-1";

const FIELD_LABEL: Record<ColumnField, string> = {
  name: "이름",
  phone: "전화번호",
  group: "그룹",
  memo: "메모",
  consent: "수신 동의",
};

type Step = "worker" | "check" | "save";
const STEP_LABEL: Record<Step, string> = {
  worker: "행 검사 (Web Worker)",
  check: "주소록·수신거부 확인",
  save: "저장",
};
// 전체 진행률에서 단계가 차지하는 몫. 저장이 가장 오래 걸린다(500행 묶음 왕복).
const STEP_WEIGHT: Record<Step, number> = {
  worker: 0.15,
  check: 0.25,
  save: 0.6,
};
const STEPS: Step[] = ["worker", "check", "save"];

type Phase =
  | { name: "pick"; error?: string }
  | { name: "reading"; fileName: string }
  | { name: "mapping"; fileName: string; info: TableInfo; error?: string }
  | {
      name: "processing";
      fileName: string;
      step: Step;
      done: number;
      total: number;
    }
  | {
      name: "done";
      fileName: string;
      rows: UploadRow[];
      inserted: number;
      elapsedMs: number;
      error?: string;
    };

// 시각·DOM 표시는 이벤트 처리 안에서만 부른다. 컴포넌트 밖 함수로 두어 렌더 중 호출로 오인되지 않게 한다.
const clock = () => performance.now();
const mark = (name: string) => performance.mark(name);
function markUploadReady(rows: number) {
  // 측정 스크립트의 기준점이다(scripts/measure-upload.mjs).
  document.documentElement.dataset.uploadReady = String(rows);
}

const columnLetter = (index: number) => String.fromCharCode(65 + (index % 26));

type PreviewRow = { rowNumber: number; cells: string[] };
const previewColumn = createColumnHelper<
  typeof dataTableFeatures,
  PreviewRow
>();

function overallPercent(step: Step, done: number, total: number): number {
  const before = STEPS.slice(0, STEPS.indexOf(step)).reduce(
    (sum, name) => sum + STEP_WEIGHT[name],
    0,
  );
  const ratio = total === 0 ? 1 : Math.min(1, done / total);
  return Math.round((before + STEP_WEIGHT[step] * ratio) * 100);
}

/** 매핑 확인: 전화번호는 꼭 있어야 하고, 한 열을 두 칸에 쓰면 안 된다. */
export function mappingError(map: ColumnMap): string | null {
  if (map.phone < 0) return "전화번호 열을 골라 주세요";
  const used = COLUMN_FIELDS.map((field) => map[field]).filter(
    (index) => index >= 0,
  );
  if (new Set(used).size !== used.length) {
    return "한 열을 두 항목에 고를 수 없어요";
  }
  return null;
}

/**
 * 엑셀 업로드 대화상자. 단계: 파일 → 첫 5행 미리보기와 열 매핑 → 처리(진행률) → 결과 요약.
 * 화면을 따로 두지 않고 주소록 위에 연다. 다 올린 뒤 결과를 주소록에서 바로 확인할 수 있다.
 *
 * 파일 읽기와 행 검사는 Web Worker(UploadSession)가 한다. 메인 스레드는 서버 확인·저장 왕복만 한다.
 * 문제가 있는 행은 저장하지 않고 "오류 행" 파일로 돌려준다. 고친 파일을 다시 올리면 이미 저장된 번호는 중복으로 건너뛴다.
 */
export function UploadDialog({
  branches,
  defaultBranchId,
  trigger,
}: {
  /** 올릴 수 있는 지점. 하나면 고르는 칸을 보이지 않는다(지점 담당자). */
  branches: readonly { id: string; name: string }[];
  defaultBranchId: string | null;
  trigger: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef<UploadSession | null>(null);
  const abort = useRef<AbortController | null>(null);

  const singleBranch = branches.length === 1 ? (branches[0] ?? null) : null;
  const target = singleBranch?.id ?? branchId;
  const busy = phase.name === "reading" || phase.name === "processing";

  function closeSession() {
    abort.current?.abort();
    abort.current = null;
    session.current?.close();
    session.current = null;
  }

  function reset(error?: string) {
    closeSession();
    setMap(null);
    setPhase({ name: "pick", error });
    if (inputRef.current) inputRef.current.value = "";
  }

  // 상태만 바꾼다. 이전 세션은 닫을 때(handleOpenChange) 이미 정리했다.
  function show() {
    setMap(null);
    setPhase({ name: "pick" });
    setBranchId(
      branches.some((branch) => branch.id === defaultBranchId)
        ? defaultBranchId
        : null,
    );
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    // 저장 중에 닫으면 일부만 저장된 채 결과를 볼 수 없다. 처리 중에는 닫지 않는다.
    if (!next && phase.name === "processing") return;
    if (!next) {
      closeSession();
      if (phase.name === "done") router.refresh();
    }
    setOpen(next);
  }

  async function handleFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      reset("파일은 5MB까지 올릴 수 있어요");
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      reset("엑셀(.xlsx, .xls) 또는 CSV 파일만 올릴 수 있어요");
      return;
    }

    closeSession();
    const current = new UploadSession();
    const controller = new AbortController();
    session.current = current;
    abort.current = controller;
    setPhase({ name: "reading", fileName: file.name });

    mark("upload:parse-start");
    let result;
    try {
      result = await current.read(file, controller.signal);
    } catch (error) {
      if (error instanceof UploadCanceledError) return;
      throw error;
    }
    mark("upload:parse-end");
    if (!result.ok) {
      reset(result.error);
      return;
    }
    markUploadReady(result.value.rowCount);
    setMap(result.value.guess);
    setPhase({ name: "mapping", fileName: file.name, info: result.value });
  }

  async function process(fileName: string, columns: ColumnMap) {
    const current = session.current;
    if (!current || !target) return;
    const controller = new AbortController();
    abort.current = controller;
    const started = clock();

    setPhase({
      name: "processing",
      fileName,
      step: "worker",
      done: 0,
      total: 1,
    });
    let classified;
    try {
      classified = await current.classify(
        columns,
        controller.signal,
        (done, total) =>
          setPhase({
            name: "processing",
            fileName,
            step: "worker",
            done,
            total,
          }),
      );
    } catch (error) {
      if (error instanceof UploadCanceledError) return;
      throw error;
    }
    if (!classified.ok) {
      reset(classified.error);
      return;
    }
    let rows = classified.value;

    // 서버 확인: 그 지점 주소록에 있는 번호, 본사 공통 수신거부.
    const phones = rows.flatMap((row) =>
      row.status === "ok" && row.phone ? [row.phone] : [],
    );
    const existing = new Set<string>();
    const optedOut = new Set<string>();
    for (let start = 0; start < phones.length; start += CHECK_BATCH) {
      setPhase({
        name: "processing",
        fileName,
        step: "check",
        done: start,
        total: phones.length,
      });
      const result = await checkUploadPhones({
        branchId: target,
        phones: phones.slice(start, start + CHECK_BATCH),
      });
      if ("error" in result) {
        setPhase({
          name: "done",
          fileName,
          rows,
          inserted: 0,
          elapsedMs: clock() - started,
          error: result.error,
        });
        return;
      }
      for (const phone of result.existing) existing.add(phone);
      for (const phone of result.optedOut) optedOut.add(phone);
    }
    rows = applyServerCheck(rows, existing, optedOut);

    const valid = rows.filter((row) => row.status === "ok" && row.phone);
    let inserted = 0;
    for (let start = 0; start < valid.length; start += SAVE_BATCH) {
      setPhase({
        name: "processing",
        fileName,
        step: "save",
        done: start,
        total: valid.length,
      });
      const result = await saveUploadBatch({
        branchId: target,
        rows: valid.slice(start, start + SAVE_BATCH).map((row) => ({
          phone: row.phone,
          name: row.name,
          memo: row.memo,
          groupNames: row.groupNames,
          consentAt: row.consentAt,
        })),
      });
      if ("error" in result) {
        // 앞 묶음은 이미 저장되었다. 같은 파일을 다시 올려도 저장된 번호는 중복으로 건너뛴다.
        setPhase({
          name: "done",
          fileName,
          rows,
          inserted,
          elapsedMs: clock() - started,
          error: `${result.error}. ${inserted.toLocaleString("ko-KR")}명까지 저장했어요. 같은 파일을 다시 올리면 남은 번호만 저장돼요`,
        });
        return;
      }
      inserted += result.inserted;
    }

    closeSession();
    setPhase({
      name: "done",
      fileName,
      rows,
      inserted,
      elapsedMs: clock() - started,
    });
  }

  async function downloadProblems(rows: readonly UploadRow[]) {
    // 오류 행이 있을 때만 쓰므로 그때 내려받는다. 주소록 화면을 열 때마다 엑셀 라이브러리를 받지 않게.
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(problemSheetRows(rows)),
      "오류 행",
    );
    XLSX.writeFile(book, "업로드-오류-행.xlsx");
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {open && (
          <DialogContent
            className="max-w-[760px]"
            title="엑셀 업로드"
            description={
              singleBranch
                ? `${singleBranch.name} 주소록에 한 번에 넣어요. 형식이 틀린 행·중복·수신거부 번호는 저장하지 않아요.`
                : "고른 지점 주소록에 한 번에 넣어요. 형식이 틀린 행·중복·수신거부 번호는 저장하지 않아요."
            }
            onEscapeKeyDown={(event) => busy && event.preventDefault()}
            onPointerDownOutside={(event) => busy && event.preventDefault()}
          >
            <Stepper phase={phase.name} />

            {phase.name === "pick" && (
              <>
                <section
                  aria-label="파일 올리기"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center",
                    dragging
                      ? "border-primary bg-primary-subtle"
                      : "border-border-strong bg-surface",
                  )}
                >
                  <FileUp
                    aria-hidden
                    className="size-8 text-text-muted"
                    strokeWidth={1.5}
                  />
                  <p className="text-body">
                    파일을 끌어다 놓거나 선택해 주세요
                  </p>
                  <p className="text-caption text-text-muted">
                    엑셀(.xlsx, .xls), CSV · 5MB ·{" "}
                    {MAX_UPLOAD_ROWS.toLocaleString("ko-KR")}행까지. 다음
                    단계에서 어느 열이 이름·번호·그룹인지 고를 수 있어요.
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
                  <Button onClick={() => inputRef.current?.click()}>
                    파일 선택
                  </Button>
                  {phase.error && (
                    <p role="alert" className="text-body-sm text-danger">
                      {phase.error}
                    </p>
                  )}
                </section>
                <a
                  href="/api/contacts/sample"
                  download
                  className="inline-flex w-fit items-center gap-1.5 rounded-sm text-body-sm font-bold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Download aria-hidden className="size-4" strokeWidth={2} />
                  체험용 샘플 엑셀(1만 행) 받기
                </a>
              </>
            )}

            {phase.name === "reading" && (
              <section
                aria-label="읽는 중"
                aria-busy
                className="flex flex-col items-center gap-3 rounded-lg border border-border p-10 text-center"
              >
                <p role="status" className="text-body">
                  파일을 읽는 중이에요
                </p>
                <p className="text-caption text-text-muted">{phase.fileName}</p>
                <Button variant="secondary" onClick={() => reset()}>
                  읽기 취소
                </Button>
              </section>
            )}

            {phase.name === "mapping" && map && (
              <MappingStep
                fileName={phase.fileName}
                info={phase.info}
                map={map}
                onMapChange={setMap}
                branches={singleBranch ? [] : branches}
                branchId={target}
                onBranchChange={setBranchId}
                onCancel={() => reset()}
                onStart={() => void process(phase.fileName, map)}
              />
            )}

            {phase.name === "processing" && (
              <ProcessingStep
                fileName={phase.fileName}
                step={phase.step}
                done={phase.done}
                total={phase.total}
              />
            )}

            {phase.name === "done" && (
              <section aria-label="업로드 결과" className="flex flex-col gap-4">
                <div className="flex items-start gap-3 rounded-lg border border-border p-5">
                  <CircleCheck
                    aria-hidden
                    className="size-6 flex-none text-status-delivered"
                    strokeWidth={1.75}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-title">
                      {phase.inserted.toLocaleString("ko-KR")}명을 추가했어요
                    </p>
                    <p
                      role="status"
                      className="text-body-sm text-text-muted tabular-nums"
                    >
                      {uploadSummaryText(
                        summarize(phase.rows),
                        phase.inserted,
                        phase.elapsedMs,
                      )}
                    </p>
                    <p className="truncate text-caption text-text-muted">
                      {phase.fileName}
                    </p>
                  </div>
                </div>
                {phase.error && (
                  <p role="alert" className="text-body-sm text-danger">
                    {phase.error}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {phase.rows.some((row) => row.status !== "ok") && (
                    <Button
                      variant="secondary"
                      className="mr-auto"
                      onClick={() => void downloadProblems(phase.rows)}
                    >
                      <Download
                        aria-hidden
                        className="size-4"
                        strokeWidth={2}
                      />
                      오류 행 받기 (
                      {phase.rows
                        .filter((row) => row.status !== "ok")
                        .length.toLocaleString("ko-KR")}
                      행)
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      router.refresh();
                      reset();
                    }}
                  >
                    다른 파일 올리기
                  </Button>
                  <Button onClick={() => handleOpenChange(false)}>닫기</Button>
                </div>
              </section>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function Stepper({ phase }: { phase: Phase["name"] }) {
  const index =
    phase === "pick" || phase === "reading"
      ? 0
      : phase === "mapping"
        ? 1
        : phase === "processing"
          ? 2
          : 3;
  const labels = ["파일", "미리보기·열 매핑", "처리", "결과"];
  return (
    <ol
      aria-label="업로드 단계"
      className="flex items-center gap-2 text-caption"
    >
      {labels.map((label, position) => (
        <li
          key={label}
          aria-current={position === index ? "step" : undefined}
          className={cn(
            "flex items-center gap-2",
            position === index
              ? "font-bold text-primary"
              : position < index
                ? "text-text"
                : "text-text-muted",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-5 items-center justify-center rounded-full border tabular-nums",
              position <= index
                ? "border-primary bg-primary text-primary-fg"
                : "border-border-strong",
            )}
          >
            {position + 1}
          </span>
          {label}
          {position < labels.length - 1 && (
            <span aria-hidden className="h-px w-6 bg-border-strong" />
          )}
        </li>
      ))}
    </ol>
  );
}

function MappingStep({
  fileName,
  info,
  map,
  onMapChange,
  branches,
  branchId,
  onBranchChange,
  onCancel,
  onStart,
}: {
  fileName: string;
  info: TableInfo;
  map: ColumnMap;
  onMapChange: (map: ColumnMap) => void;
  branches: readonly { id: string; name: string }[];
  branchId: string | null;
  onBranchChange: (id: string) => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const fieldOf = useMemo(() => {
    const result = new Map<number, ColumnField>();
    for (const field of COLUMN_FIELDS) {
      if (map[field] >= 0) result.set(map[field], field);
    }
    return result;
  }, [map]);

  const columns = useMemo<DataTableColumn<PreviewRow>[]>(
    () => [
      previewColumn.display({
        id: "row",
        header: "줄",
        meta: { width: "48px", align: "right" },
        cell: ({ row }) => (
          <span className="text-text-muted tabular-nums">
            {row.original.rowNumber}
          </span>
        ),
      }),
      ...info.header.map((title, index) =>
        previewColumn.display({
          id: `c${index}`,
          meta: { width: "minmax(96px, 1fr)" },
          header: () => {
            const field = fieldOf.get(index);
            return (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">
                  {columnLetter(index)} · {title || "(머리글 없음)"}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-0.5 text-caption",
                    field ? "text-primary" : "font-medium text-text-disabled",
                  )}
                >
                  {field && (
                    <ArrowRight
                      aria-hidden
                      className="size-3 flex-none"
                      strokeWidth={2.4}
                    />
                  )}
                  {field ? FIELD_LABEL[field] : "사용 안 함"}
                </span>
              </span>
            );
          },
          cell: ({ row }) => (
            <span
              className={cn(
                "truncate",
                !fieldOf.has(index) && "text-text-disabled",
              )}
            >
              {row.original.cells[index] ?? ""}
            </span>
          ),
        }),
      ),
    ],
    [info.header, fieldOf],
  );

  const error = mappingError(map);
  const options = [
    { value: UNUSED, label: "사용 안 함" },
    ...info.header.map((title, index) => ({
      value: String(index),
      label: `${columnLetter(index)} · ${title || "(머리글 없음)"}`,
    })),
  ];
  const needsBranch = branches.length > 0 && !branchId;

  return (
    <section aria-label="미리보기와 열 매핑" className="flex flex-col gap-4">
      <p className="text-body-sm text-text-muted">
        <b className="text-text">{fileName}</b> ·{" "}
        {info.rowCount.toLocaleString("ko-KR")}행 · 첫 5행 미리보기
      </p>
      <div className="max-h-[260px] overflow-auto rounded-md border border-border">
        <DataTable
          ariaLabel="첫 5행 미리보기"
          columns={columns}
          rows={info.preview}
          getRowId={(row) => String(row.rowNumber)}
          rowHeight={36}
        />
      </div>

      <fieldset className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <legend className="mb-2 text-body-sm font-bold">열 매핑</legend>
        {COLUMN_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-caption font-bold text-text-muted">
              {FIELD_LABEL[field]}
              {field === "phone" && <span className="text-danger"> *</span>}
            </span>
            <SelectMenu
              label={`${FIELD_LABEL[field]} 열`}
              value={String(map[field])}
              options={options}
              onChange={(value) =>
                onMapChange({ ...map, [field]: Number(value) })
              }
            />
          </label>
        ))}
        {branches.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-caption font-bold text-text-muted">
              넣을 지점<span className="text-danger"> *</span>
            </span>
            <SelectMenu
              label="넣을 지점"
              value={branchId ?? ""}
              options={branches.map((branch) => ({
                value: branch.id,
                label: branch.name,
              }))}
              onChange={onBranchChange}
            />
          </label>
        )}
      </fieldset>

      {(error || needsBranch) && (
        <p role="alert" className="text-body-sm text-danger">
          {error ?? "넣을 지점을 골라 주세요"}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          다른 파일 고르기
        </Button>
        <Button disabled={Boolean(error) || needsBranch} onClick={onStart}>
          {info.rowCount.toLocaleString("ko-KR")}행 처리 시작
        </Button>
      </div>
    </section>
  );
}

function ProcessingStep({
  fileName,
  step,
  done,
  total,
}: {
  fileName: string;
  step: Step;
  done: number;
  total: number;
}) {
  const percent = overallPercent(step, done, total);
  return (
    <section
      aria-label="처리 중"
      aria-busy
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p role="status" className="text-body font-bold">
          {STEP_LABEL[step]} 중이에요
        </p>
        <span className="text-number-lg tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="업로드 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="flex flex-col gap-1 text-body-sm">
        {STEPS.map((name) => {
          const position = STEPS.indexOf(name);
          const current = STEPS.indexOf(step);
          return (
            <li
              key={name}
              className={cn(
                "flex justify-between gap-3 tabular-nums",
                position > current && "text-text-muted",
                position === current && "font-bold",
              )}
            >
              <span>{STEP_LABEL[name]}</span>
              <span>
                {position < current
                  ? "완료"
                  : position === current
                    ? `${done.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}`
                    : "대기"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="truncate text-caption text-text-muted">{fileName}</p>
    </section>
  );
}
