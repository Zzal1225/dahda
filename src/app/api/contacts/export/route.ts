import { NextResponse, type NextRequest } from "next/server";
import {
  buildContactWorkbook,
  MAX_EXPORT_ROWS,
} from "@/features/contacts/contact-export";
import {
  contactFiltersSchema,
  listContacts,
  type ContactRow,
} from "@/features/contacts/contact-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

// PostgREST의 한 번 응답 상한이 기본 1000행이다.
const CHUNK = 1000;

/**
 * 본사만 받는다. 전체 번호가 파일로 나가면 다시 가져올 수 없어 화면 조회보다 범위를 좁게 둔다.
 * 세션 클라이언트로 읽어 RLS도 함께 적용된다. 버튼을 숨기는 것만으로는 주소 직접 입력을 막지 못한다.
 */
export async function GET(request: NextRequest) {
  await requireRole(["hq"]);

  const filters = contactFiltersSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const supabase = await createSupabaseServerClient();

  const rows: ContactRow[] = [];
  for (let page = 1; ; page += 1) {
    const chunk = await listContacts(supabase, { ...filters, page }, CHUNK);
    if (chunk.total > MAX_EXPORT_ROWS) {
      return new NextResponse(
        `한 번에 ${MAX_EXPORT_ROWS.toLocaleString("ko-KR")}건까지 내보낼 수 있어요. 지점이나 그룹으로 좁혀 주세요.`,
        {
          status: 413,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    rows.push(...chunk.rows);
    if (rows.length >= chunk.total || chunk.rows.length === 0) break;
  }

  return new NextResponse(new Uint8Array(buildContactWorkbook(rows)), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="dahda-contacts.xlsx"',
      // 개인정보가 담긴 응답이다. 브라우저와 CDN에 남기지 않는다.
      "Cache-Control": "no-store",
    },
  });
}
