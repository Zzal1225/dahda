import { describe, expect, it } from "vitest";
import { toCurrentMember, type MemberRow } from "./to-current-member";

const base: MemberRow = {
  user_id: "u1",
  org_id: "o1",
  branch_id: null,
  role: "hq",
  display_name: "정우진",
  organizations: { name: "dahda마트 본사", trial_expires_at: null },
  branches: null,
};

describe("toCurrentMember", () => {
  it("본사 구성원은 지점 정보가 null이다", () => {
    expect(toCurrentMember(base)).toEqual({
      userId: "u1",
      orgId: "o1",
      orgName: "dahda마트 본사",
      branchId: null,
      branchName: null,
      role: "hq",
      displayName: "정우진",
      isTrial: false,
    });
  });

  it("지점 구성원은 지점 이름을 함께 준다", () => {
    const member = toCurrentMember({
      ...base,
      role: "branch",
      branch_id: "b1",
      branches: { name: "성수점" },
    });
    expect(member).toMatchObject({
      role: "branch",
      branchId: "b1",
      branchName: "성수점",
    });
  });

  it("체험 만료 시각이 있으면 체험 계정이다", () => {
    const member = toCurrentMember({
      ...base,
      organizations: { name: "체험", trial_expires_at: "2026-11-07T00:00:00Z" },
    });
    expect(member.isTrial).toBe(true);
  });
});
