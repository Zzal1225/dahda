// @vitest-environment node
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildContactWorkbook } from "./contact-export";
import type { ContactRow } from "./contact-query";

const row = (over: Partial<ContactRow>): ContactRow => ({
  id: "1",
  branchId: "b",
  branchName: "성수점",
  phone: "01012345678",
  name: "김손님",
  memo: null,
  consentAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  groupIds: [],
  receiveStatus: "not_consented",
  optedOut: false,
  ...over,
});

function read(rows: ContactRow[]) {
  const book = XLSX.read(buildContactWorkbook(rows), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0] ?? ""];
  if (!sheet) throw new Error("시트 없음");
  return sheet;
}

describe("buildContactWorkbook", () => {
  it("머리글과 값을 순서대로 쓴다", () => {
    const sheet = read([
      row({
        memo: "단골",
        optedOut: true,
        consentAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ["지점", "전화번호", "이름", "메모", "수신거부", "수신 동의"],
      ["성수점", "01012345678", "김손님", "단골", "수신거부", "2026-03-01"],
    ]);
  });

  it("전화번호 앞의 0을 지키도록 글자로 쓴다", () => {
    const cell = read([row({})]).B2;
    expect(cell?.t).toBe("s");
    expect(cell?.v).toBe("01012345678");
  });

  it("수식처럼 보이는 메모를 실행되지 않는 글자로 쓴다", () => {
    const cell = read([row({ memo: '=HYPERLINK("http://x","클릭")' })]).D2;
    expect(cell?.t).toBe("s");
    expect(cell?.f).toBeUndefined();
  });

  it("없는 값은 빈 칸이다", () => {
    const rows = XLSX.utils.sheet_to_json(
      read([row({ name: null, branchName: null })]),
      { header: 1 },
    ) as unknown[][];
    expect(rows[1]?.[1]).toBe("01012345678");
    expect(rows[1]?.[2] ?? "").toBe("");
  });

  it("행이 없어도 머리글이 있는 파일을 만든다", () => {
    expect(XLSX.utils.sheet_to_json(read([]), { header: 1 })).toHaveLength(1);
  });
});
