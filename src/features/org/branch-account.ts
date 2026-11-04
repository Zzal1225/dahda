import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { BranchAccountInput } from "./branch-schema";

export type BranchAccountError =
  "branch_not_found" | "already_assigned" | "email_taken" | "failed";

/**
 * 지점 담당 계정을 만든다. 호출자는 본사인지 먼저 확인해야 한다.
 * Auth 사용자 생성과 구성원 저장은 한 트랜잭션으로 묶을 수 없어, 뒤 단계가 실패하면 만든 사용자를 지워 되돌린다.
 * 클라이언트를 인자로 받아 Next 요청 없이도 실제 DB로 통합 테스트할 수 있게 했다.
 */
export async function createBranchAccount(
  admin: SupabaseClient<Database>,
  orgId: string,
  branchId: string,
  input: BranchAccountInput,
): Promise<BranchAccountError | null> {
  // org_id를 함께 봐서, 위조한 지점 id로 다른 본사에 계정을 만들지 못하게 한다.
  const branch = await admin
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (branch.error) return "failed";
  if (!branch.data) return "branch_not_found";

  const existing = await admin
    .from("members")
    .select("user_id")
    .eq("branch_id", branchId)
    .maybeSingle();
  if (existing.error) return "failed";
  if (existing.data) return "already_assigned";

  const created = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    return created.error?.code === "email_exists" ? "email_taken" : "failed";
  }

  const member = await admin.from("members").insert({
    user_id: created.data.user.id,
    org_id: orgId,
    branch_id: branchId,
    role: "branch",
    display_name: input.displayName,
  });
  if (member.error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    // 위의 확인과 저장 사이에 다른 요청이 먼저 지정한 경우 지점당 1명 제약에 걸린다.
    return member.error.code === "23505" ? "already_assigned" : "failed";
  }

  return null;
}
