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

export type UploadRowStatus = "ok" | "invalid" | "duplicate" | "opted_out";

export type UploadRow = {
  /** 엑셀에서 보이는 줄 번호. 사용자가 원본을 찾아갈 수 있어야 한다. */
  rowNumber: number;
  phoneInput: string;
  phone: string | null;
  name: string | null;
  memo: string | null;
  /** 파일의 원래 값. 사용자가 번호를 고친 뒤 다시 검사할 때 쓴다. */
  consentInput: string | null;
  consentAt: string | null;
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

export type ColumnMap = {
  phone: number;
  name: number;
  memo: number;
  consent: number;
};

export function detectColumns(headerRow: readonly unknown[]): ColumnMap | null {
  const headers = headerRow.map((cell) => String(cell ?? ""));
  const phone = findColumn(headers, PHONE_HEADERS);
  if (phone < 0) return null;
  return {
    phone,
    name: findColumn(headers, NAME_HEADERS),
    memo: findColumn(headers, MEMO_HEADERS),
    consent: findColumn(headers, CONSENT_HEADERS),
  };
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

/** 시트의 2차원 배열을 행으로 바꾼다. 첫 줄은 머리글이고 완전히 빈 줄은 건너뛴다. */
export function rowsFromSheet(
  table: readonly (readonly unknown[])[],
): ParseResult {
  const [header, ...body] = table;
  const columns = header ? detectColumns(header) : null;
  if (!columns) {
    return {
      ok: false,
      error:
        '첫 줄에서 전화번호 열을 찾지 못했어요. 첫 줄에 "전화번호"라고 적어 주세요',
    };
  }

  const rows: UploadRow[] = [];
  body.forEach((cells, index) => {
    if (!cells.some((cell) => String(cell ?? "").trim())) return;
    rows.push(
      classifyRow(
        index + 2,
        cellToPhoneText(cells[columns.phone]),
        columns.name >= 0 ? cellToText(cells[columns.name]) : null,
        columns.memo >= 0 ? cellToText(cells[columns.memo]) : null,
        columns.consent >= 0 ? cellToConsentText(cells[columns.consent]) : null,
      ),
    );
  });

  if (rows.length === 0) return { ok: false, error: "저장할 행이 없어요" };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return {
      ok: false,
      error: `한 번에 ${MAX_UPLOAD_ROWS.toLocaleString("ko-KR")}행까지 올릴 수 있어요`,
    };
  }
  return { ok: true, rows: markFileDuplicates(rows) };
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
