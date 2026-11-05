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
    <div aria-hidden className="flex max-w-[1200px] flex-col gap-5">
      <div className="h-14 w-64 rounded-sm bg-skeleton" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-32 rounded-lg bg-skeleton" />
        <div className="h-32 rounded-lg bg-skeleton" />
        <div className="h-32 rounded-lg bg-skeleton" />
      </div>
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
