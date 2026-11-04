import { describe, expect, it } from "vitest";
import { buildBranchRows } from "./branch-rows";

const branches = [
  { id: "b2", name: "합정점" },
  { id: "b1", name: "망원점" },
];

describe("buildBranchRows", () => {
  it("담당자와 잔액을 지점에 붙이고 이름순으로 정렬한다", () => {
    const rows = buildBranchRows(
      branches,
      [{ branch_id: "b2", display_name: "합정 담당" }],
      [{ branch_id: "b2", balance: 500 }],
    );
    expect(rows).toEqual([
      { id: "b1", name: "망원점", accountName: null, balance: 0 },
      { id: "b2", name: "합정점", accountName: "합정 담당", balance: 500 },
    ]);
  });

  it("본사 계정의 구성원과 잔액을 지점에 섞지 않는다", () => {
    const rows = buildBranchRows(
      branches,
      [{ branch_id: null, display_name: "본사" }],
      [{ branch_id: null, balance: 9999 }],
    );
    expect(
      rows.every((row) => row.accountName === null && row.balance === 0),
    ).toBe(true);
  });

  it("지점이 없으면 빈 목록이다", () => {
    expect(buildBranchRows([], [], [])).toEqual([]);
  });
});
