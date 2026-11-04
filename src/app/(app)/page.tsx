import { Suspense } from "react";
import { getCurrentMember } from "@/server/auth/current-member";

async function Scope() {
  const member = await getCurrentMember();
  if (!member) return null;

  return (
    <p className="text-body-sm text-text-muted">
      {member.orgName} · {member.branchName ?? "전체 지점 + 본사 발송 기준"}
    </p>
  );
}

// 임시 홈. 오늘 숫자와 진행 중인 발송은 데이터가 생긴 뒤 step5에서 채운다.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-title-lg">홈</h1>
      <Suspense
        fallback={
          <div aria-hidden className="h-5 w-48 rounded-sm bg-skeleton" />
        }
      >
        <Scope />
      </Suspense>
    </div>
  );
}
