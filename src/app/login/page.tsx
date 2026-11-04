import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginPanel } from "@/features/auth/login-panel";
import { getCurrentMember } from "@/server/auth/current-member";

export const metadata: Metadata = { title: "로그인 · dahda" };

/** 소속까지 있는 사용자만 돌려보낸다. 세션만 있는 사용자를 보내면 앱 쪽 검사와 서로 돌려보내는 순환이 생긴다. */
async function RedirectIfMember() {
  const member = await getCurrentMember();
  if (member) redirect("/");
  return null;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense fallback={null}>
        <RedirectIfMember />
      </Suspense>
      <LoginPanel />
    </main>
  );
}
