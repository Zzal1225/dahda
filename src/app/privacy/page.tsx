import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "개인정보처리방침 · dahda" };

const ITEMS = [
  {
    title: "수집하는 정보",
    lines: [
      "계정: 이메일 로그인 계정의 이메일과 이름. 체험 계정은 이메일 없이 임의의 사용자 id만 만듭니다.",
      "주소록: 사용자가 입력하거나 올린 전화번호, 이름, 메모.",
      "체험 문자: 직접 입력한 전화번호.",
      "결제: 주문번호, 결제 키, 금액. 카드 번호는 받지 않습니다.",
    ],
  },
  {
    title: "보관 기간",
    lines: [
      "체험 계정과 그 데이터: 3일 뒤 삭제합니다.",
      "체험 문자의 중복 발송 방지 값(번호의 해시): 30일 뒤 삭제합니다.",
      "문자 업체와 결제 업체가 보낸 결과 기록: 90일 뒤 삭제합니다.",
      "일반 계정의 데이터: 계정이 유지되는 동안 보관합니다.",
    ],
  },
  {
    title: "외부 업체에 전달하는 정보",
    lines: [
      "솔라피(문자 발송): 수신 번호, 발신번호, 문자 본문. 실제 문자를 보낼 때만 전달합니다.",
      "토스페이먼츠(테스트 결제): 주문번호, 금액, 임의의 구매자 id.",
      "Supabase(데이터베이스·로그인), Vercel(서비스 호스팅): 서비스 운영에 필요한 위 정보가 저장되거나 지나갑니다.",
    ],
  },
  {
    title: "문의",
    lines: [
      "이 프로젝트의 GitHub 저장소 이슈로 문의하거나 삭제를 요청할 수 있습니다.",
    ],
  },
];

/** 로그인 전에도 읽는 화면이라 앱 틀 밖에 둔다. 값이 바뀌면 코드의 삭제 작업과 함께 고친다. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-title-lg">개인정보처리방침</h1>
        <p className="text-body-sm text-text-muted">
          dahda는 채용 포트폴리오로 만든 프로젝트이며 상업 서비스가 아닙니다.
          체험 계정에는 실제 고객의 번호를 넣지 말아 주세요.
        </p>
      </div>
      {ITEMS.map((item) => (
        <section key={item.title} className="flex flex-col gap-2">
          <h2 className="text-body font-bold">{item.title}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm">
            {item.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-caption text-text-muted">
        시행일 2026년 11월 5일 ·{" "}
        <Link href="/" className="underline">
          dahda로 돌아가기
        </Link>
      </p>
    </main>
  );
}
