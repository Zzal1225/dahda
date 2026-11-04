import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dahda",
  description:
    "문자가 닿았는지까지 확인하는 마트·소상공인용 문자 발송 관리자 콘솔",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <head>
        {/* 핸드오프가 지정한 SUIT 배포본. 한글 글꼴이라 next/font 서브셋 대상이 아니다.
            첫 화면 성능에 영향이 크면 측정 5(Lighthouse) 때 자체 호스팅과 비교한다. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/static/woff2/SUIT.css"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
