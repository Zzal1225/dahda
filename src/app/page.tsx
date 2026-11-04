/**
 * 1-4에서 로그인 화면으로 교체할 임시 첫 화면.
 * 미구현 기능을 숨기는 원칙에 따라 버튼 없이 이름과 설명만 둔다.
 */
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-display text-primary">dahda</h1>
      <p className="text-body text-text-muted">
        문자는 도착이 확인된 순간에 끝납니다.
      </p>
    </main>
  );
}
