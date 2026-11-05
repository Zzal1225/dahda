import { describe, expect, it } from "vitest";
import {
  applyServerCheck,
  cellToPhoneText,
  classifyRow,
  decodeCsv,
  detectColumns,
  MAX_UPLOAD_ROWS,
  rowsFromSheet,
  summarize,
} from "./upload-rows";

describe("detectColumns", () => {
  it.each([
    [["전화번호", "이름", "메모"], { phone: 0, name: 1, memo: 2, consent: -1 }],
    [["이름", "휴대폰"], { phone: 1, name: 0, memo: -1, consent: -1 }],
    [
      [" 전화 번호 ", "성명", "비고"],
      { phone: 0, name: 1, memo: 2, consent: -1 },
    ],
    [["Name", "PHONE"], { phone: 1, name: 0, memo: -1, consent: -1 }],
  ])("%j", (header, expected) => {
    expect(detectColumns(header)).toEqual(expected);
  });

  it("수신 동의 열을 찾는다", () => {
    expect(detectColumns(["전화번호", "수신 동의"])?.consent).toBe(1);
    expect(detectColumns(["번호", "동의일시"])?.consent).toBe(1);
  });

  it("전화번호 열이 없으면 null이다", () => {
    expect(detectColumns(["이름", "주소"])).toBeNull();
  });
});

describe("cellToPhoneText", () => {
  it.each([
    [1012345678, "01012345678"],
    [1112345678, "01112345678"],
    ["010-1234-5678", "010-1234-5678"],
    [212345678, "212345678"],
    [null, ""],
    [undefined, ""],
  ])("%j → %j", (cell, expected) => {
    expect(cellToPhoneText(cell)).toBe(expected);
  });
});

describe("classifyRow", () => {
  it("올바른 행은 번호를 정규화한다", () => {
    expect(classifyRow(2, "010-0000-0001", "김", null)).toMatchObject({
      phone: "01000000001",
      status: "ok",
      problem: null,
    });
  });

  it.each([
    ["", null, null, "전화번호가 비어 있어요"],
    ["abc", null, null, "전화번호 형식이 맞지 않아요"],
    ["01000000001", "가".repeat(31), null, "이름은 30자까지 쓸 수 있어요"],
    ["01000000001", null, "가".repeat(201), "메모는 200자까지 쓸 수 있어요"],
  ])("%j", (phone, name, memo, problem) => {
    expect(classifyRow(2, phone, name, memo)).toMatchObject({
      status: "invalid",
      problem,
    });
  });

  it("경계값은 통과한다", () => {
    expect(
      classifyRow(2, "01000000001", "가".repeat(30), "가".repeat(200)).status,
    ).toBe("ok");
  });
});

describe("rowsFromSheet", () => {
  const header = ["전화번호", "이름"];

  it("줄 번호는 엑셀에서 보이는 번호다", () => {
    const result = rowsFromSheet([
      header,
      ["01000000001", "김"],
      ["abc", "이"],
    ]);
    expect(result.ok && result.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it("빈 줄은 건너뛰되 뒤 행의 줄 번호는 유지한다", () => {
    const result = rowsFromSheet([
      header,
      ["01000000001", "김"],
      ["", " "],
      [],
      ["01000000002", "이"],
    ]);
    expect(result.ok && result.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
  });

  it("파일 안의 같은 번호는 표기가 달라도 뒤의 행이 중복이다", () => {
    const result = rowsFromSheet([
      header,
      ["010-0000-0001", "김"],
      ["01000000001", "이"],
    ]);
    expect(result.ok && result.rows.map((r) => r.status)).toEqual([
      "ok",
      "duplicate",
    ]);
    expect(result.ok && result.rows[1]?.problem).toBe(
      "2번째 줄과 같은 번호예요",
    );
  });

  it("숫자 칸의 번호에 맨 앞 0을 되살린다", () => {
    const result = rowsFromSheet([header, [1000000001, "김"]]);
    expect(result.ok && result.rows[0]?.phone).toBe("01000000001");
  });

  it.each([
    ["머리글 없음", [["이름"], ["김"]]],
    ["빈 시트", []],
    ["행 없음", [header]],
  ])("%s이면 오류다", (_, table) => {
    expect(rowsFromSheet(table).ok).toBe(false);
  });

  it("행 수 제한의 경계", () => {
    const body = (count: number) =>
      Array.from({ length: count }, (_, index) => [
        `010${String(index).padStart(8, "0")}`,
      ]);
    expect(rowsFromSheet([header, ...body(MAX_UPLOAD_ROWS)]).ok).toBe(true);
    expect(rowsFromSheet([header, ...body(MAX_UPLOAD_ROWS + 1)]).ok).toBe(
      false,
    );
  });
});

describe("applyServerCheck", () => {
  const rows = [
    classifyRow(2, "01000000001", null, null),
    classifyRow(3, "01000000002", null, null),
    classifyRow(4, "01000000003", null, null),
    classifyRow(5, "abc", null, null),
  ];

  it("기존 번호와 수신거부를 표시하고 형식 오류는 그대로 둔다", () => {
    const checked = applyServerCheck(
      rows,
      new Set(["01000000001"]),
      new Set(["01000000002"]),
    );
    expect(checked.map((r) => r.status)).toEqual([
      "duplicate",
      "opted_out",
      "ok",
      "invalid",
    ]);
  });

  it("주소록에도 있고 수신거부도 한 번호는 수신거부로 표시한다", () => {
    const [row] = applyServerCheck(
      rows,
      new Set(["01000000001"]),
      new Set(["01000000001"]),
    );
    expect(row?.status).toBe("opted_out");
  });
});

describe("summarize", () => {
  it("상태별로 센다", () => {
    const checked = applyServerCheck(
      [
        classifyRow(2, "01000000001", null, null),
        classifyRow(3, "01000000002", null, null),
        classifyRow(4, "abc", null, null),
      ],
      new Set(["01000000002"]),
      new Set(),
    );
    expect(summarize(checked)).toEqual({
      ok: 1,
      invalid: 1,
      duplicate: 1,
      opted_out: 0,
    });
  });
});

describe("decodeCsv", () => {
  it("UTF-8을 읽는다", () => {
    expect(decodeCsv(new TextEncoder().encode("전화번호"))).toBe("전화번호");
  });

  it("한국어 Excel의 CP949를 읽는다", () => {
    const cp949 = new Uint8Array([
      0xc0, 0xfc, 0xc8, 0xad, 0xb9, 0xf8, 0xc8, 0xa3,
    ]);
    expect(decodeCsv(cp949)).toBe("전화번호");
  });
});

describe("수신 동의 칸", () => {
  const NOW = new Date("2026-11-05T00:00:00Z");

  it("Y는 동의 시각이 되고 비면 미동의다", () => {
    expect(classifyRow(2, "01000000001", null, null, "Y", NOW).consentAt).toBe(
      NOW.toISOString(),
    );
    expect(
      classifyRow(2, "01000000001", null, null, null, NOW).consentAt,
    ).toBeNull();
  });

  it("모르는 값은 저장하지 않고 고치게 한다", () => {
    expect(
      classifyRow(2, "01000000001", null, null, "아마도", NOW),
    ).toMatchObject({ status: "invalid", consentAt: null });
  });

  it("시트에서 동의 열을 읽는다", () => {
    const parsed = rowsFromSheet([
      ["전화번호", "수신 동의"],
      ["01000000001", "2026-03-01"],
      ["01000000002", ""],
    ]);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows[0]?.consentAt).toBe("2026-02-28T15:00:00.000Z");
    expect(parsed.rows[1]?.consentAt).toBeNull();
  });
});
