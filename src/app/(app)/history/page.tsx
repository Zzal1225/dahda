import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { HistoryScreen } from "@/features/messages/history-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "발송 내역 · dahda" };

async function History() {
  const member = await requireRole(["hq", "branch"]);

  // 지점 필터는 본사에게만 보인다. 지점 사용자는 RLS상 자기 지점만 읽혀서 조회해도 해가 없지만 필요도 없다.
  let branches: { id: string; name: string }[] = [];
  if (member.role === "hq") {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("branches")
      .select("id, name")
      .order("name");
    if (error) throw new Error(`지점 조회 실패: ${error.message}`);
    branches = data;
  }

  return (
    // 주소의 쿼리를 읽는 어댑터라 세션과 같은 Suspense 경계 안에 둔다. 레이아웃에 두면 모든 화면이 쿼리에 묶인다.
    <NuqsAdapter>
      <HistoryScreen
        scope={`${member.userId}:${member.branchId ?? member.role}`}
        role={member.role}
        accountBranchId={member.branchId}
        liveFilter={
          member.branchId
            ? `branch_id=eq.${member.branchId}`
            : `org_id=eq.${member.orgId}`
        }
        branches={branches}
      />
    </NuqsAdapter>
  );
}

function HistorySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="h-8 w-32 rounded-sm bg-skeleton" />
      <div className="h-24 rounded-lg bg-skeleton" />
      <div className="h-64 rounded-lg bg-skeleton" />
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      <History />
    </Suspense>
  );
}
