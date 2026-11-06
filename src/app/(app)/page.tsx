import { Suspense } from "react";
import { loadHome } from "@/features/home/home-query";
import { HomeScreen } from "@/features/home/home-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

async function Home() {
  const member = await requireRole(["hq", "branch"]);
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const data = await loadHome(supabase, {
    orgId: member.orgId,
    isHq: member.role === "hq",
    now,
  });
  return <HomeScreen member={member} data={data} now={now} />;
}

function HomeSkeleton() {
  return (
    // 실제 화면과 같은 폭(data-wide)과 같은 띠 모양으로 둔다. 다르면 내용이 들어올 때 화면이 튄다.
    <div data-wide aria-hidden className="flex w-full flex-col gap-5">
      <div className="h-14 w-80 rounded-sm bg-skeleton" />
      <div className="h-36 rounded-lg bg-skeleton" />
      <div className="h-64 rounded-lg bg-skeleton" />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}
