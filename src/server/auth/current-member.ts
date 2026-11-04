import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { toCurrentMember, type CurrentMember } from "./to-current-member";

export type { CurrentMember } from "./to-current-member";

/**
 * 현재 로그인 사용자의 구성원 정보. 로그인하지 않았거나 소속이 없으면 null이다.
 *
 * 'use cache: private'를 쓰지 않는다. 기본 5분 동안 값이 재사용되어 역할 전환 직후 이전 역할의 메뉴가
 * 보일 수 있기 때문이다. 대신 프리페치 이득을 포기하고 요청마다 DB에서 읽는다.
 * react cache는 한 번의 렌더 안에서 사이드바·상단 바·본문이 같은 조회를 반복하지 않게 할 뿐이다.
 */
export const getCurrentMember = cache(
  async (): Promise<CurrentMember | null> => {
    const supabase = await createSupabaseServerClient();

    // getSession은 쿠키 값을 검증 없이 믿는다. 권한 판단에 쓰므로 인증 서버에 확인하는 getUser를 쓴다.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("members")
      .select(
        "user_id, org_id, branch_id, role, display_name, organizations(name, trial_expires_at), branches(name)",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    // 조회 실패를 null로 삼키면 DB 장애가 "로그아웃"으로 보인다.
    if (error) throw new Error(`구성원 조회 실패: ${error.message}`);
    return data ? toCurrentMember(data) : null;
  },
);
