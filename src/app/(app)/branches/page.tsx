import type { Metadata } from "next";
import { Suspense } from "react";
import { buildBranchRows } from "@/features/org/branch-rows";
import { BranchList } from "@/features/org/branch-list";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "지점 관리 · dahda" };

async function Branches() {
  const member = await requireRole(["hq"]);
  const supabase = await createSupabaseServerClient();

  // 모두 사용자 권한으로 읽는다. 타사 지점이 섞이지 않는 것은 RLS가 보장한다.
  const [branches, members, balances] = await Promise.all([
    supabase.from("branches").select("id, name"),
    supabase.from("members").select("branch_id, display_name"),
    supabase.from("account_balances").select("branch_id, balance"),
  ]);
  const error = branches.error ?? members.error ?? balances.error;
  // 오류를 빈 목록으로 보여 주면 "지점이 없다"로 오해한다. error.tsx로 넘긴다.
  if (error) throw new Error(`지점 조회 실패: ${error.message}`);

  return (
    <BranchList
      rows={buildBranchRows(
        branches.data ?? [],
        members.data ?? [],
        balances.data ?? [],
      )}
      isTrial={member.isTrial}
    />
  );
}

function BranchesSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="h-8 w-40 rounded-sm bg-skeleton" />
      <div className="h-40 rounded-lg bg-skeleton" />
    </div>
  );
}

export default function BranchesPage() {
  return (
    <Suspense fallback={<BranchesSkeleton />}>
      <Branches />
    </Suspense>
  );
}
