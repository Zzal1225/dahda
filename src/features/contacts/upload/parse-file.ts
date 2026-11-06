import * as XLSX from "xlsx";
import {
  decodeCsv,
  MAX_UPLOAD_ROWS,
  splitSheet,
  type SheetTable,
} from "./upload-rows";

export type ReadResult =
  { ok: true; table: SheetTable } | { ok: false; error: string };

/**
 * 파일을 표로 읽는다. CPU를 오래 쓰므로 어디서 부르는지가 중요하다(측정 2). Worker에서만 부른다.
 *
 * sheetRows로 읽을 행을 제한한다. 압축률이 높은 악의적 파일이나 실수로 고른 큰 파일을
 * 끝까지 풀지 않고, 제한을 넘는지 알 수 있을 만큼만 읽는다(머리글 + 한도 + 1행).
 */
export function readSheet(buffer: ArrayBuffer, fileName: string): ReadResult {
  const sheetRows = MAX_UPLOAD_ROWS + 2;
  try {
    const workbook = /\.csv$/i.test(fileName)
      ? XLSX.read(decodeCsv(new Uint8Array(buffer)), {
          type: "string",
          sheetRows,
          // 번호와 날짜처럼 보이는 값을 바꾸지 않고 글자 그대로 읽는다.
          raw: true,
        })
      : XLSX.read(buffer, { type: "array", sheetRows });

    const firstSheet = workbook.SheetNames[0];
    const sheet = firstSheet ? workbook.Sheets[firstSheet] : undefined;
    if (!sheet) return { ok: false, error: "시트를 찾지 못했어요" };

    return splitSheet(
      XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
      }),
    );
  } catch {
    return {
      ok: false,
      error: "파일을 읽지 못했어요. 엑셀 또는 CSV 파일인지 확인해 주세요",
    };
  }
}
