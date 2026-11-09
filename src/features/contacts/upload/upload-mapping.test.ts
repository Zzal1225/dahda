import { describe, expect, it } from "vitest";
import { mappingError } from "./upload-dialog";
import {
  classifyTable,
  guessColumns,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS_PER_ROW,
  parseGroupNames,
  previewLines,
  problemSheetRows,
  splitSheet,
  summarize,
  uploadSummaryText,
  type ColumnMap,
  type SheetTable,
} from "./upload-rows";

const NOW = new Date("2026-11-06T03:00:00.000Z");
const table = (rows: unknown[][]): SheetTable => {
  const result = splitSheet(rows);
  if (!result.ok) throw new Error(result.error);
  return result.table;
};
const map = (over: Partial<ColumnMap> = {}): ColumnMap => ({
  name: -1,
  phone: 0,
  group: -1,
  memo: -1,
  consent: -1,
  ...over,
});

describe("guessColumns", () => {
  it("그룹 열을 머리글로 찾는다", () => {
    expect(guessColumns(["이름", "휴대폰", "고객 분류", "비고"])).toEqual({
      name: 0,
      phone: 1,
      group: 2,
      memo: 3,
      consent: -1,
    });
  });

  it("전화번호 열을 못 찾아도 null이 아니라 -1이다(사용자가 고른다)", () => {
    expect(guessColumns(["A", "B"]).phone).toBe(-1);
  });
});

describe("parseGroupNames", () => {
  it.each([
    [null, []],
    ["", []],
    ["단골", ["단골"]],
    ["단골, 과일 행사", ["단골", "과일 행사"]],
    ["단골;신규/배달", ["단골", "신규", "배달"]],
    // 같은 이름·빈 조각은 합치고 버린다
    ["단골, 단골, ,", ["단골"]],
  ])("%j → %j", (text, expected) => {
    expect(parseGroupNames(text)).toEqual(expected);
  });

  it(`${MAX_GROUPS_PER_ROW}개까지 받고 넘으면 오류다`, () => {
    const names = (count: number) =>
      Array.from({ length: count }, (_, index) => `그룹${index}`).join(",");
    expect(parseGroupNames(names(MAX_GROUPS_PER_ROW))).toHaveLength(
      MAX_GROUPS_PER_ROW,
    );
    expect(parseGroupNames(names(MAX_GROUPS_PER_ROW + 1))).toBeNull();
  });

  it(`이름은 ${MAX_GROUP_NAME_LENGTH}자까지다`, () => {
    expect(parseGroupNames("가".repeat(MAX_GROUP_NAME_LENGTH))).toHaveLength(1);
    expect(parseGroupNames("가".repeat(MAX_GROUP_NAME_LENGTH + 1))).toBeNull();
  });
});

describe("splitSheet·previewLines", () => {
  it("빈 줄을 빼도 엑셀 줄 번호는 원래대로다", () => {
    const sheet = table([
      ["전화번호"],
      ["010-1000-0001"],
      [null],
      ["010-1000-0002"],
    ]);
    expect(sheet.lines.map((line) => line.rowNumber)).toEqual([2, 4]);
  });

  it("미리보기는 5줄이고, 숫자로 저장된 번호는 맨 앞 0을 되살린다", () => {
    const sheet = table([
      ["전화번호", "이름"],
      ...Array.from({ length: 8 }, (_, index) => [
        1010000000 + index,
        `손님${index}`,
      ]),
    ]);
    const preview = previewLines(sheet);
    expect(preview).toHaveLength(5);
    expect(preview[0]?.cells).toEqual(["01010000000", "손님0"]);
  });

  it("머리글만 있으면 저장할 행이 없다", () => {
    expect(splitSheet([["전화번호"]])).toMatchObject({ ok: false });
  });
});

describe("classifyTable", () => {
  it("고른 열로 분류한다. 머리글과 관계없다", () => {
    const sheet = table([
      ["A", "B", "C"],
      ["김손님", "010-1000-0001", "단골, 신규"],
    ]);
    const [row] = classifyTable(sheet, map({ name: 0, phone: 1, group: 2 }));
    expect(row).toMatchObject({
      status: "ok",
      phone: "01010000001",
      name: "김손님",
      groupNames: ["단골", "신규"],
    });
  });

  it("그룹 칸이 잘못되면 형식 오류이고, 원래 칸 값을 남긴다", () => {
    const long = "가".repeat(MAX_GROUP_NAME_LENGTH + 1);
    const sheet = table([
      ["번호", "그룹"],
      ["010-1000-0001", long],
    ]);
    const [row] = classifyTable(sheet, map({ group: 1 }));
    expect(row?.status).toBe("invalid");
    expect(row?.groupNames).toEqual([long]);
  });

  it("번호 형식 오류가 그룹 오류보다 앞선다", () => {
    const sheet = table([
      ["번호", "그룹"],
      ["abc", "가".repeat(40)],
    ]);
    expect(classifyTable(sheet, map({ group: 1 }))[0]?.problem).toBe(
      "전화번호 형식이 맞지 않아요",
    );
  });

  it("파일 안 중복을 표시하고, 진행률은 0에서 시작해 전체로 끝난다", () => {
    const sheet = table([["번호"], ["010-1000-0001"], ["010-1000-0001"]]);
    const calls: [number, number][] = [];
    const rows = classifyTable(
      sheet,
      map(),
      (done, total) => {
        calls.push([done, total]);
      },
      NOW,
    );
    expect(rows.map((row) => row.status)).toEqual(["ok", "duplicate"]);
    expect(calls[0]).toEqual([0, 2]);
    expect(calls.at(-1)).toEqual([2, 2]);
  });
});

describe("mappingError", () => {
  it.each([
    [map(), null],
    [map({ phone: -1 }), "전화번호 열을 골라 주세요"],
    [map({ name: 0 }), "한 열을 두 항목에 고를 수 없어요"],
    [map({ name: 1, memo: 2, group: 3, consent: 4 }), null],
  ])("%j → %s", (value, expected) => {
    expect(mappingError(value)).toBe(expected);
  });
});

describe("uploadSummaryText", () => {
  it("다섯 숫자를 한 줄로 쓴다. 처리 시간은 소수 한 자리 초다", () => {
    expect(
      uploadSummaryText(
        { ok: 9_700, duplicate: 130, invalid: 100, opted_out: 30 },
        9_700,
        12_345,
      ),
    ).toBe(
      "추가 9,700 · 중복 130 · 형식 오류 100 · 수신거부 제외 30 · 처리 시간 12.3초",
    );
  });

  it("아주 빨라도 0초로 쓰지 않는다", () => {
    expect(
      uploadSummaryText(
        { ok: 1, duplicate: 0, invalid: 0, opted_out: 0 },
        1,
        3,
      ),
    ).toContain("처리 시간 0.1초");
  });
});

describe("problemSheetRows", () => {
  it("문제 행만, 원래 값과 사유를 담는다", () => {
    const sheet = table([
      ["번호", "이름"],
      ["010-1000-0001", "정상"],
      ["잘못", "오류"],
    ]);
    const rows = classifyTable(sheet, map({ name: 1 }));
    expect(summarize(rows)).toMatchObject({ ok: 1, invalid: 1 });
    expect(problemSheetRows(rows)).toEqual([
      ["엑셀 줄", "전화번호", "이름", "그룹", "메모", "수신동의", "문제"],
      ["3", "잘못", "오류", "", "", "", "전화번호 형식이 맞지 않아요"],
    ]);
  });
});
