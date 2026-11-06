import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { demoSenderNumber } from "@/features/demo/demo-config";
import { DemoSmsForm } from "@/features/demo/demo-sms-form";
import { requireRole } from "@/server/auth/requireRole";
import { DEMO_SMS_BODY } from "@/server/providers/demo-sms";

export const metadata: Metadata = { title: "실제 문자 받아 보기 · dahda" };

async function DemoSms() {
  const member = await requireRole(["hq", "branch"]);
  if (!member.isTrial || !demoSenderNumber()) notFound();

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title">실제 문자 받아 보기</h1>
        <p className="text-body-sm text-text-muted">
          문자 업체를 통해 실제 문자가 나가요. 보낸 뒤 발송 내역에서 접수와 도착
          상태가 새로고침 없이 바뀌는 것을 폰과 함께 볼 수 있어요.
        </p>
      </div>
      <section
        aria-label="보낼 내용"
        className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
      >
        <span className="text-caption text-text-muted">
          보낼 내용 (고칠 수 없어요)
        </span>
        <p className="text-body-sm">{DEMO_SMS_BODY}</p>
      </section>
      <DemoSmsForm />
    </div>
  );
}

export default function DemoSmsPage() {
  return (
    <Suspense>
      <DemoSms />
    </Suspense>
  );
}
