import { normalizePhone } from "@/lib/phone";
import { cellToConsentText, parseConsent } from "../consent";

/**
 * 엑셀 내용을 저장 가능한 행으로 분류하는 순수 함수. 브라우저(Worker)에서 돌지만 DB 없이 경계값을 시험한다.
 * 업체·법 규칙이 아니라 "이 파일의 행을 믿어도 되는가"만 본다. 서버는 저장할 때 다시 검사한다.
 */

export const MAX_UPLOAD_ROWS = 20_000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_NAME_LENGTH = 30;
const MAX_MEMO_LENGTH = 200;

export const MAX_GROUP_NAME_LENGTH = 30;
export const MAX_GROUPS_PER_ROW = 5;

export type UploadRowStatus = "ok" | "invalid" | "duplicate" | "opted_out";

export type UploadRow = {
  /** 엑셀에서 보이는 줄 번호. 사용자가 원본을 찾아갈 수 있어야 한다. */
  rowNumber: number;
  phoneInput: string;
  phone: string | null;
  name: string | null;
  memo: string | null;
  /** 파일의 원래 값. 오류 행 파일에 그대로 돌려준다. */
  consentInput: string | null;
  consentAt: string | null;
  /** 그룹 칸의 이름들. 저장할 때 같은 이름의 그룹에 넣고, 없으면 만든다. */
  groupNames: string[];
  status: UploadRowStatus;
  problem: string | null;
};

const PHONE_HEADERS = [
  "전화번호",
  "휴대폰",
  "휴대전화",
  "핸드폰",
  "연락처",
  "번호",
  "phone",
  "mobile",
  "tel",
];
const NAME_HEADERS = ["이름", "성명", "고객명", "name"];
const MEMO_HEADERS = ["메모", "비고", "memo", "note"];
const GROUP_HEADERS = ["그룹", "그룹명", "분류", "고객분류", "group"];
const CONSENT_HEADERS = [
  "수신동의",
  "수신동의일",
  "수신동의일시",
  "광고동의",
  "동의",
  "동의일",
  "동의일시",
  "consent",
];

function findColumn(headers: readonly string[], candidates: readonly string[]) {
  return headers.findIndex((header) =>
    candidates.includes(header.replace(/\s/g, "").toLowerCase()),
  );
}

/** 열 매핑. 값은 열 번호이고 -1은 "사용 안 함"이다. */
export const COLUMN_FIELDS = [
  "name",
  "phone",
  "group",
  "memo",
  "consent",
] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];
export type ColumnMap = Record<ColumnField, number>;

/** 머리글로 열을 짐작한다. 사용자가 미리보기에서 고칠 수 있으므로 못 찾은 열은 -1로 둔다. */
export function guessColumns(headerRow: readonly unknown[]): ColumnMap {
  const headers = headerRow.map((cell) => String(cell ?? ""));
  return {
    name: findColumn(headers, NAME_HEADERS),
    phone: findColumn(headers, PHONE_HEADERS),
    group: findColumn(headers, GROUP_HEADERS),
    memo: findColumn(headers, MEMO_HEADERS),
    consent: findColumn(headers, CONSENT_HEADERS),
  };
}

/** 전화번호 열을 머리글로 찾지 못하면 null이다. 자동 경로(rowsFromSheet)가 쓴다. */
export function detectColumns(headerRow: readonly unknown[]): ColumnMap | null {
  const map = guessColumns(headerRow);
  return map.phone < 0 ? null : map;
}

/**
 * 그룹 칸: "단골, 과일 행사"처럼 쉼표·세미콜론·슬래시로 여러 개를 적을 수 있다. 같은 이름은 하나로 합친다.
 * 이름이 너무 길거나 너무 많으면 null(형식 오류)이다. 잘못 쓴 칸으로 그룹이 수십 개 생기면 안 된다.
 */
export function parseGroupNames(text: string | null): string[] | null {
  if (!text) return [];
  const names = [
    ...new Set(
      text
        .split(/[,;/]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length > MAX_GROUPS_PER_ROW) return null;
  if (names.some((name) => name.length > MAX_GROUP_NAME_LENGTH)) return null;
  return names;
}

/**
 * 엑셀은 010-1234-5678이 아닌 01012345678을 숫자로 저장해 맨 앞 0을 없앤다.
 * 숫자 칸의 1012345678은 사실상 항상 이 경우라 0을 되살린다. 안 하면 업로드의 대부분이 형식 오류가 된다.
 */
export function cellToPhoneText(cell: unknown): string {
  if (typeof cell === "number") {
    const digits = String(Math.trunc(cell));
    return /^1[016789][0-9]{7,8}$/.test(digits) ? `0${digits}` : digits;
  }
  return cell === null || cell === undefined ? "" : String(cell);
}

function cellToText(cell: unknown): string | null {
  const text = cell === null || cell === undefined ? "" : String(cell).trim();
  return text || null;
}

export function classifyRow(
  rowNumber: number,
  phoneInput: string,
  name: string | null,
  memo: string | null,
  consentInput: string | null = null,
  now: Date = new Date(),
): UploadRow {
  const consent = parseConsent(consentInput, now);
  const base = {
    rowNumber,
    phoneInput,
    name,
    memo,
    consentInput,
    consentAt: consent.ok ? consent.consentAt : null,
    groupNames: [],
  };
  const phone = normalizePhone(phoneInput);
  if (!phone) {
    return {
      ...base,
      phone: null,
      status: "invalid",
      problem: phoneInput.trim()
        ? "전화번호 형식이 맞지 않아요"
        : "전화번호가 비어 있어요",
    };
  }
  if (name && name.length > MAX_NAME_LENGTH) {
    return {
      ...base,
      phone,
      status: "invalid",
      problem: `이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있어요`,
    };
  }
  if (memo && memo.length > MAX_MEMO_LENGTH) {
    return {
      ...base,
      phone,
      status: "invalid",
      problem: `메모는 ${MAX_MEMO_LENGTH}자까지 쓸 수 있어요`,
    };
  }
  if (!consent.ok) {
    return {
      ...base,
      phone,
      status: "invalid",
      problem: "수신 동의는 Y, N 또는 날짜(2026-03-01)로 적어 주세요",
    };
  }
  return { ...base, phone, status: "ok", problem: null };
}

/** 파일 안에서 같은 번호가 또 나오면 뒤의 행을 중복으로 표시한다. 먼저 나온 행이 저장된다. */
export function markFileDuplicates(rows: readonly UploadRow[]): UploadRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.status !== "ok" || !row.phone) return row;
    const first = seen.get(row.phone);
    if (first !== undefined) {
      return {
        ...row,
        status: "duplicate",
        problem: `${first}번째 줄과 같은 번호예요`,
      };
    }
    seen.set(row.phone, row.rowNumber);
    return row;
  });
}

/** 서버가 알려 준 기존 번호·수신거부 번호를 반영한다. 수신거부를 먼저 본다. 보내면 안 되는 쪽이 더 중요하다. */
export function applyServerCheck(
  rows: readonly UploadRow[],
  existing: ReadonlySet<string>,
  optedOut: ReadonlySet<string>,
): UploadRow[] {
  return rows.map((row) => {
    if (row.status !== "ok" || !row.phone) return row;
    if (optedOut.has(row.phone)) {
      return { ...row, status: "opted_out", problem: "수신거부한 번호예요" };
    }
    if (existing.has(row.phone)) {
      return { ...row, status: "duplicate", problem: "이미 주소록에 있어요" };
    }
    return row;
  });
}

export type UploadSummary = Record<UploadRowStatus, number>;

export function summarize(rows: readonly UploadRow[]): UploadSummary {
  const summary: UploadSummary = {
    ok: 0,
    invalid: 0,
    duplicate: 0,
    opted_out: 0,
  };
  for (const row of rows) summary[row.status] += 1;
  return summary;
}

export type ParseResult =
  { ok: true; rows: UploadRow[] } | { ok: false; error: string };

/** 빈 줄을 뺀 본문 한 줄. 엑셀 줄 번호를 함께 들고 다녀야 오류 행을 원본에서 찾을 수 있다. */
export type SheetLine = { rowNumber: number; cells: readonly unknown[] };
export type SheetTable = { header: string[]; lines: SheetLine[] };

/** 첫 줄은 머리글, 완전히 빈 줄은 건너뛴다. 행 수 한도는 여기서 본다(읽은 직후, 매핑 전에 알려 준다). */
export function splitSheet(
  table: readonly (readonly unknown[])[],
): { ok: true; table: SheetTable } | { ok: false; error: string } {
  const [header, ...body] = table;
  if (!header) return { ok: false, error: "저장할 행이 없어요" };
  const lines: SheetLine[] = [];
  body.forEach((cells, index) => {
    if (!cells.some((cell) => String(cell ?? "").trim())) return;
    lines.push({ rowNumber: index + 2, cells });
  });
  if (lines.length === 0) return { ok: false, error: "저장할 행이 없어요" };
  if (lines.length > MAX_UPLOAD_ROWS) {
    return {
      ok: false,
      error: `한 번에 ${MAX_UPLOAD_ROWS.toLocaleString("ko-KR")}행까지 올릴 수 있어요`,
    };
  }
  return {
    ok: true,
    table: { header: header.map((cell) => String(cell ?? "").trim()), lines },
  };
}

/** 미리보기용 글자. 번호 칸의 사라진 0은 되살려 보여 준다(저장할 값과 같게). */
export function previewLines(
  table: SheetTable,
  count = 5,
): { rowNumber: number; cells: string[] }[] {
  return table.lines.slice(0, count).map((line) => ({
    rowNumber: line.rowNumber,
    cells: table.header.map((_, index) => cellToPhoneText(line.cells[index])),
  }));
}

const PROGRESS_EVERY = 500;

/**
 * 매핑대로 모든 줄을 분류한다. 그룹 칸이 잘못되면 그 줄은 형식 오류다.
 * onProgress는 Worker가 진행률을 보내는 데 쓴다. 2만 줄이어도 수십 ms라 촘촘히 보낼 필요는 없다.
 */
export function classifyTable(
  table: SheetTable,
  map: ColumnMap,
  onProgress?: (done: number, total: number) => void,
  now: Date = new Date(),
): UploadRow[] {
  const at = (cells: readonly unknown[], index: number) =>
    index >= 0 ? cellToText(cells[index]) : null;
  const total = table.lines.length;
  const rows = table.lines.map((line, index) => {
    if (onProgress && index % PROGRESS_EVERY === 0) onProgress(index, total);
    const row = classifyRow(
      line.rowNumber,
      map.phone >= 0 ? cellToPhoneText(line.cells[map.phone]) : "",
      at(line.cells, map.name),
      at(line.cells, map.memo),
      map.consent >= 0 ? cellToConsentText(line.cells[map.consent]) : null,
      now,
    );
    const groupText = at(line.cells, map.group);
    const groupNames = parseGroupNames(groupText);
    if (groupNames === null) {
      // 오류 행 파일에 원래 칸 값을 돌려주려고 그대로 담는다. 저장되지 않는 행이다.
      const raw = { ...row, groupNames: groupText ? [groupText] : [] };
      return row.status === "invalid"
        ? raw
        : {
            ...raw,
            status: "invalid" as const,
            problem: `그룹은 쉼표로 나눠 ${MAX_GROUPS_PER_ROW}개까지, 이름은 ${MAX_GROUP_NAME_LENGTH}자까지 쓸 수 있어요`,
          };
    }
    return { ...row, groupNames };
  });
  onProgress?.(total, total);
  return markFileDuplicates(rows);
}

/** 머리글로 열을 찾아 바로 분류한다(매핑 화면 없이). 전화번호 열이 없으면 오류다. */
export function rowsFromSheet(
  table: readonly (readonly unknown[])[],
): ParseResult {
  const split = splitSheet(table);
  const columns = table[0] ? detectColumns(table[0]) : null;
  if (!columns) {
    return {
      ok: false,
      error:
        '첫 줄에서 전화번호 열을 찾지 못했어요. 첫 줄에 "전화번호"라고 적어 주세요',
    };
  }
  if (!split.ok) return split;
  return { ok: true, rows: classifyTable(split.table, columns) };
}

/** 결과 요약. 추가 수는 저장 응답에서, 나머지는 분류 결과에서 온다. */
export function uploadSummaryText(
  summary: UploadSummary,
  inserted: number,
  elapsedMs: number,
): string {
  const n = (value: number) => value.toLocaleString("ko-KR");
  const seconds = Math.max(0.1, Math.round(elapsedMs / 100) / 10);
  return `추가 ${n(inserted)} · 중복 ${n(summary.duplicate)} · 형식 오류 ${n(summary.invalid)} · 수신거부 제외 ${n(summary.opted_out)} · 처리 시간 ${seconds.toLocaleString("ko-KR")}초`;
}

/** 오류 행 파일의 내용. 원래 칸 값과 문제를 함께 준다. 고쳐서 그대로 다시 올릴 수 있게 머리글을 맞춘다. */
export function problemSheetRows(rows: readonly UploadRow[]): string[][] {
  return [
    ["엑셀 줄", "전화번호", "이름", "그룹", "메모", "수신동의", "문제"],
    ...rows
      .filter((row) => row.status !== "ok")
      .map((row) => [
        String(row.rowNumber),
        row.phoneInput,
        row.name ?? "",
        row.groupNames.join(", "),
        row.memo ?? "",
        row.consentInput ?? "",
        row.problem ?? "",
      ]),
  ];
}

/**
 * 한국어 Excel의 CSV는 대부분 CP949다. UTF-8로 읽으면 머리글이 깨져 "전화번호 열이 없다"는 엉뚱한 오류가 난다.
 * UTF-8로 먼저 엄격히 읽고, 실패하면 CP949로 읽는다.
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}
