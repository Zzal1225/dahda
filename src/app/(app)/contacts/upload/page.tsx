import type { Metadata } from "next";
import { Suspense } from "react";
import { UploadScreen } from "@/features/contacts/upload/upload-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "엑셀 업로드 · dahda" };

async function Upload() {
  // 주소록 쓰기는 지점만 한다. 본사는 주소록 화면에 버튼이 없고 주소로 들어와도 돌아간다.
  await requireRole(["branch"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contact_groups")
    .select("id, name")
    .order("name");
  if (error) throw new Error(`그룹 조회 실패: ${error.message}`);

  return <UploadScreen groups={data} />;
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-64 rounded-lg bg-skeleton" />}
    >
      <Upload />
    </Suspense>
  );
}
