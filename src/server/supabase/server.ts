import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "@/server/db/database.types";

/**
 * 요청 사용자의 권한으로 동작하는 클라이언트. 조회는 기본적으로 이것을 써서 RLS를 거치게 한다.
 * 요청마다 새로 만든다. 모듈 전역에 두면 한 사용자의 쿠키가 다른 사용자의 요청에 섞일 수 있다.
 */
export async function createSupabaseServerClient() {
  // Auth 클라이언트는 생성할 때 현재 시각을 읽는다. 쿠키 조회만으로는 세션별 미리 렌더링 단계가 남아
  // Next가 불안정한 값으로 거부하므로, 실제 요청까지 기다린다. 역할을 캐시하지 않기로 한 결정과도 맞다.
  await connection();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 토큰 갱신은 proxy.ts가 맡으므로 여기서는 무시해도 된다.
          }
        },
      },
    },
  );
}
