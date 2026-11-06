import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { buildSampleRows } from "@/features/contacts/upload/sample-sheet";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 업로드 대화상자의 "체험용 샘플 엑셀(1만 행) 받기". 매번 새로 만든다(번호가 무작위).
 *
 * 체험 계정만 실제 주소록·수신거부 번호를 섞는다. 그래야 결과에 "중복"과 "수신거부 제외"가 나온다.
 * 실제 계정은 섞지 않는다: 표에서 가린 번호가 이 파일로 전체 번호가 되어 나가면 가리는 의미가 없다.
 */
export async function GET() {
  const member = await requireRole(["hq", "branch"]);
  let existingPhones: string[] = [];
  let optOutPhones: string[] = [];

  if (member.isTrial) {
    const supabase = await createSupabaseServerClient();
    const [contacts, optOuts] = await Promise.all([
      supabase.from("contacts").select("phone").limit(50),
      supabase.from("opt_outs").select("phone").limit(30),
    ]);
    existingPhones = contacts.data?.map((row) => row.phone) ?? [];
    optOutPhones = optOuts.data?.map((row) => row.phone) ?? [];
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    // 모든 칸이 글자라 010의 0이 사라지지 않는다.
    XLSX.utils.aoa_to_sheet(buildSampleRows({ existingPhones, optOutPhones })),
    "연락처",
  );
  const buffer = XLSX.write(book, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        "attachment; filename*=UTF-8''dahda-sample-contacts-10000.xlsx",
      "Cache-Control": "no-store",
    },
  });
}
