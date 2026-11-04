import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";

/**
 * RLS를 건너뛰는 클라이언트. 상태·돈·구성원처럼 사용자에게 쓰기를 열지 않은 데이터만 다룬다.
 * 부르는 쪽이 권한을 먼저 확인해야 한다. 쿠키를 넘기지 않으므로 세션과 섞이지 않는다.
 */
export function createSupabaseAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 없다");

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    secretKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
