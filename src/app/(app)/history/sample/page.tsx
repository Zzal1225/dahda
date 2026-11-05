import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { PUBLIC_SAMPLE_CAMPAIGN_ID } from "@/features/messages/public-sample";
import { SampleScreen } from "@/features/messages/sample-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const metadata: Metadata = { title: "10만 행 샘플 · dahda" };

async function Sample() {
  await requireRole(["hq", "branch"]);
  // 샘플 조직은 구성원이 없어 RLS로 읽을 수 없다. 고정 id만 읽고 수신자 수 말고는 내보내지 않는다.
  const { data, error } = await createSupabaseAdminClient()
    .from("campaigns")
    .select("recipient_count")
    .eq("id", PUBLIC_SAMPLE_CAMPAIGN_ID)
    .maybeSingle();
  if (error) throw new Error(`샘플 조회 실패: ${error.message}`);
  if (!data) notFound();

  return (
    <NuqsAdapter>
      <SampleScreen total={data.recipient_count} />
    </NuqsAdapter>
  );
}

export default function SamplePage() {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-96 rounded-lg bg-skeleton" />}
    >
      <Sample />
    </Suspense>
  );
}
