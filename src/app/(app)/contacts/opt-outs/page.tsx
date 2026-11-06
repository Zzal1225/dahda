import { redirect } from "next/navigation";
import { Suspense } from "react";

/**
 * 수신거부는 주소록 왼쪽 목록의 한 항목이 되었다. 예전 주소(/contacts/opt-outs)로 들어와도 같은 화면을 보여 준다.
 * 북마크·공유한 링크가 404가 되지 않게 남긴다.
 * 요청 값(searchParams)을 읽으므로 Suspense 안에서 한다(Cache Components는 경계 밖 요청 값 접근을 빌드에서 막는다).
 */
async function Redirect({
  searchParams,
}: Pick<PageProps<"/contacts/opt-outs">, "searchParams">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  redirect(
    `/contacts?${new URLSearchParams({ group: "opt-outs", ...(q ? { q } : {}) })}`,
  );
  return null;
}

export default function OptOutsRedirect(
  props: PageProps<"/contacts/opt-outs">,
) {
  return (
    <Suspense fallback={null}>
      <Redirect searchParams={props.searchParams} />
    </Suspense>
  );
}
