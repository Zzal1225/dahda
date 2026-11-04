import "server-only";
import type { CurrentMember } from "@/server/auth/current-member";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export type TrialRoleOption = {
  /** null이면 본사 역할이다. */
  branchId: string | null;
  label: string;
  description: string;
};

const HQ_OPTION: TrialRoleOption = {
  branchId: null,
  label: "본사 관리자",
  description: "전 지점 조회 · 지점 광고 승인 · 본사 잔액으로 발송",
};

/**
 * 지점 역할일 때는 RLS가 다른 지점을 숨기므로 admin 클라이언트로 전체 지점을 읽는다.
 * 체험 계정의 자기 본사 지점 이름만 돌려주며, 실제 계정은 빈 목록이다.
 */
export async function getTrialRoleOptions(
  member: CurrentMember,
): Promise<TrialRoleOption[]> {
  if (!member.isTrial) return [];

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("branches")
    .select("id, name")
    .eq("org_id", member.orgId)
    .order("name");
  if (error) throw new Error(`지점 조회 실패: ${error.message}`);

  return [
    HQ_OPTION,
    ...data.map((branch) => ({
      branchId: branch.id,
      label: `지점 · ${branch.name}`,
      description: "내 지점 발송과 충전 · 광고는 본사 승인 후 발송",
    })),
  ];
}
