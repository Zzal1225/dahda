import "server-only";
import { redirect } from "next/navigation";
import { getCurrentMember, type CurrentMember } from "./current-member";
import type { MemberRole } from "./to-current-member";

/**
 * 서버 코드의 관문. 화면 메뉴를 숨겨도 주소를 직접 입력하거나 Server Action을 직접 부를 수 있으므로,
 * 페이지와 Server Action은 시작할 때 이 함수를 부른다. service_role을 쓰는 코드는 RLS를 건너뛰므로
 * 이 검사가 사실상 유일한 경계다.
 *
 * 사용자 id를 입력으로 받지 않는다. 호출자는 항상 세션에서 읽어야 다른 사람을 사칭할 수 없다.
 * 실패를 값으로 돌려주지 않고 redirect로 흐름을 끊는다. 값이면 검사 결과를 확인하지 않는 실수가 그대로 통과된다.
 */
export async function requireRole(
  allowed: readonly MemberRole[],
): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!allowed.includes(member.role)) redirect("/");
  return member;
}
