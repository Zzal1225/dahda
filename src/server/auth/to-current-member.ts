import type { Database } from "@/server/db/database.types";

export type MemberRole = Database["public"]["Enums"]["member_role"];

export type CurrentMember = {
  userId: string;
  orgId: string;
  orgName: string;
  /** null이면 본사 계정이다. */
  branchId: string | null;
  branchName: string | null;
  role: MemberRole;
  displayName: string;
  isTrial: boolean;
};

export type MemberRow = {
  user_id: string;
  org_id: string;
  branch_id: string | null;
  role: MemberRole;
  display_name: string;
  organizations: { name: string; trial_expires_at: string | null };
  branches: { name: string } | null;
};

/** DB의 snake_case를 화면 타입으로 바꾸는 경계. 이 밖에서는 DB 열 이름을 몰라도 된다. */
export function toCurrentMember(row: MemberRow): CurrentMember {
  return {
    userId: row.user_id,
    orgId: row.org_id,
    orgName: row.organizations.name,
    branchId: row.branch_id,
    branchName: row.branches?.name ?? null,
    role: row.role,
    displayName: row.display_name,
    isTrial: row.organizations.trial_expires_at !== null,
  };
}
