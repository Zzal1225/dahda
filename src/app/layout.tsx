import type { Metadata } from "next";
import "./globals.css";

const TITLE = "dahda · 문자가 닿았는지까지 확인하는 발송 콘솔";
const DESCRIPTION =
  "마트·소상공인이 손님에게 문자를 보내고, 도착 결과까지 확인하는 B2B 문자 발송 관리자 콘솔. 로그인 없이 체험할 수 있어요.";

export const metadata: Metadata = {
  // 미리보기 이미지는 절대 주소여야 한다. 메신저와 SNS는 상대 경로를 읽지 못한다.
  metadataBase: new URL("https://dahda-xi.vercel.app"),
  title: "dahda",
  description: DESCRIPTION,
  // 이미지는 같은 폴더의 opengraph-image.png를 Next.js가 자동으로 넣는다.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "dahda",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
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
