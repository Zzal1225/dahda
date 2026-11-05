import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/server/db/database.types";

/**
 * 두 가지만 한다: 만료된 토큰 갱신, 로그인 안 한 요청을 로그인 화면으로 보내기.
 * 서버 컴포넌트는 쿠키를 쓸 수 없어서 토큰 갱신을 이 단계에서 해야 한다.
 *
 * 권한 판단은 하지 않는다. 역할 확인은 getCurrentMember와 requireRole, 최종 경계는 RLS다.
 * 로그인한 사용자를 /login에서 밀어내는 일도 여기서 하지 않는다. 소속이 없는 사용자라면
 * "/" → 소속 없음 → "/login" → "/"로 끝없이 돌기 때문이다. 그 판단은 로그인 화면이 소속까지 보고 한다.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // 사용자별 Set-Cookie 응답이 CDN에 캐시되면 다른 사람에게 세션이 넘어갈 수 있다.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 처리방침은 로그인 전에도 읽을 수 있어야 한다. 체험을 시작하기 전에 볼 내용이다.
  const isPublic = ["/login", "/privacy"].includes(request.nextUrl.pathname);
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // 웹훅은 업체가 부르므로 세션이 없고, 정적 파일은 인증이 필요 없다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/payments/webhook).*)",
  ],
};
