import "server-only";
import type { CurrentMember } from "@/server/auth/current-member";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 내 계정의 잔액. 본사는 RLS상 전 지점이 보이므로 branch_id로 "내 계정"을 직접 좁혀야 한다.
 * 거래 기록이 없는 계정은 뷰에 행이 없으므로 0원이다.
 */
export async function getOwnBalance(member: CurrentMember): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from("account_balances")
    .select("balance")
    .eq("org_id", member.orgId);

  const { data, error } = await (
    member.branchId
      ? query.eq("branch_id", member.branchId)
      : query.is("branch_id", null)
  ).maybeSingle();

  if (error) throw new Error(`잔액 조회 실패: ${error.message}`);
  return data?.balance ?? 0;
}
