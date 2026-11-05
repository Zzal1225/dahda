import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { SenderTable } from "@/features/org/sender-table";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "설정 · dahda" };

const ROLE_LABEL = { hq: "본사", branch: "지점" } as const;

async function Settings() {
  const member = await requireRole(["hq", "branch"]);
  const supabase = await createSupabaseServerClient();
  // RLS가 범위를 정한다. 본사는 전 지점 번호, 지점은 자기 번호만 읽힌다.
  const { data, error } = await supabase
    .from("sender_numbers")
    .select("id, branch_id, number, label, is_default, branches(name)")
    .order("branch_id", { nullsFirst: true })
    .order("is_default", { ascending: false })
    .order("number");
  if (error) throw new Error(`발신번호 조회 실패: ${error.message}`);

  const senders = data.map((row) => ({
    id: row.id,
    owner: row.branches?.name ?? "본사",
    label: row.label,
    number: row.number,
    isDefault: row.is_default,
  }));
  const info = [
    ["이름", member.displayName],
    ["본사", member.orgName],
    ["지점", member.branchName ?? "—"],
    ["역할", ROLE_LABEL[member.role]],
    ["계정 종류", member.isTrial ? "체험 (3일 뒤 삭제)" : "일반"],
  ] as const;

  return (
    <div className="flex max-w-[800px] flex-col gap-6">
      <h1 className="text-title-lg">설정</h1>

      <section
        aria-label="내 정보"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-body font-bold">내 정보</h2>
        <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-2 text-body-sm">
          {info.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="발신번호 목록" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-body font-bold">발신번호</h2>
          {/* 추가 화면을 두지 않는다. 문자 업체에 사전 등록한 번호만 보낼 수 있어, 화면에서 넣어도 나가지 않는다. */}
          <p className="text-caption text-text-muted">
            문자 업체에 등록한 번호만 쓸 수 있어 여기서는 조회만 해요.
          </p>
        </div>
        {senders.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-12 text-center text-body-sm text-text-muted">
            등록된 발신번호가 없어요
          </p>
        ) : (
          <SenderTable rows={senders} />
        )}
      </section>

      <section
        aria-label="계정"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-5"
      >
        <Link href="/privacy" className="text-body-sm underline">
          개인정보처리방침
        </Link>
        <SignOutButton />
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-64 rounded-lg bg-skeleton" />}
    >
      <Settings />
    </Suspense>
  );
}
