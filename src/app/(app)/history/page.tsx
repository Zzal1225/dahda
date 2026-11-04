import type { Metadata } from "next";
import { Suspense } from "react";
import { PlainRecipientTable } from "@/features/messages/plain-recipient-table";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "발송 내역 · dahda" };

async function History({ searchParams }: PageProps<"/history">) {
  await requireRole(["hq", "branch"]);
  const { campaign } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`발송 건 조회 실패: ${error.message}`);

  const campaignId = typeof campaign === "string" ? campaign : data?.id;
  if (!campaignId) return <p>아직 보낸 문자가 없어요</p>;

  return <PlainRecipientTable campaignId={campaignId} />;
}

// 메뉴는 필터와 가상화 표까지 만든 뒤에 연다. 지금은 측정용 "변경 전" 화면이다.
export default function HistoryPage(props: PageProps<"/history">) {
  return (
    <>
      <h1 className="text-title-lg">발송 내역</h1>
      <Suspense fallback={<p>불러오는 중</p>}>
        <History {...props} />
      </Suspense>
    </>
  );
}
