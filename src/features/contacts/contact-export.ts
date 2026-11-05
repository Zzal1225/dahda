import * as XLSX from "xlsx";
import type { ContactRow } from "./contact-query";

/** 내보내기 상한. 메모리에서 한 번에 만들므로 넘으면 조건을 좁히게 한다. */
export const MAX_EXPORT_ROWS = 100_000;
const HEADER = ["지점", "전화번호", "이름", "메모", "수신거부", "수신 동의"];

/**
 * 모든 값을 글자로 쓴다. 숫자로 넣으면 010의 0이 사라진다.
 * CSV 대신 xlsx를 쓴다. 글자 칸은 "=" 로 시작해도 수식으로 실행되지 않는데, CSV는 열 때 실행될 수 있다.
 * 메모는 지점 사용자가 쓴 값이고 받는 사람은 본사이므로 이 차이가 중요하다.
 */
export function buildContactWorkbook(rows: readonly ContactRow[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    HEADER,
    ...rows.map((row) => [
      row.branchName ?? "",
      row.phone,
      row.name ?? "",
      row.memo ?? "",
      row.optedOut ? "수신거부" : "",
      row.consentAt ? row.consentAt.slice(0, 10) : "",
    ]),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "주소록");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
