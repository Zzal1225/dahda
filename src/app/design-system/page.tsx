import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { InteractiveSamples } from "@/features/design-system/component-samples";
import {
  COLOR_GROUPS,
  SIZE_TOKENS,
  TYPE_SCALE,
} from "@/features/design-system/design-tokens";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "디자인 시스템 · dahda" };

const STATUSES = [
  ["idle", "대기"],
  ["sent", "접수"],
  ["delivered", "도착"],
  ["failed", "실패"],
  ["pending", "승인 대기"],
  ["approved", "승인"],
  ["rejected", "반려"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-title">{title}</h2>
      {children}
    </section>
  );
}

/** 로그인 전에도 볼 수 있는 공개 화면이다. 데이터를 읽지 않고 샘플 값만 그린다. */
export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-title-lg">디자인 시스템</h1>
        <p className="text-body-sm text-text-muted">
          dahda 화면이 쓰는 토큰과 공통 컴포넌트예요. 샘플은 앱과 같은 코드로
          그려요. 상태는 색만으로 구분하지 않고 모양을 함께 써요.
        </p>
        <Link href="/login" className="text-body-sm underline">
          dahda로 돌아가기
        </Link>
      </div>

      <Section title="색">
        {COLOR_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <h3 className="text-body-sm font-bold">{group.title}</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {group.tokens.map((token) => (
                <li key={token} className="flex flex-col gap-1">
                  <div
                    aria-hidden
                    className="h-12 rounded-md border border-border"
                    style={{ background: `var(${token})` }}
                  />
                  <code className="text-caption break-all">{token}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section title="글자">
        <ul className="flex flex-col gap-3">
          {TYPE_SCALE.map((item) => (
            <li
              key={item.name}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3"
            >
              <span className={cn(item.className)}>닿았는지 확인해요 123</span>
              <span className="text-caption text-text-muted">
                {item.name} · {item.usage}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="크기">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body-sm sm:grid-cols-[220px_1fr]">
          {SIZE_TOKENS.map(([token, usage]) => (
            <div key={token} className="contents">
              <dt>
                <code className="text-caption">{token}</code>
              </dt>
              <dd className="text-text-muted">{usage}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="상태">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(([tone, label]) => (
            <StatusBadge key={tone} tone={tone} label={label} />
          ))}
        </div>
        <div className="max-w-[320px]">
          <ProgressBar
            counts={{ queued: 10, sent: 15, delivered: 70, failed: 5 }}
            total={100}
          />
        </div>
      </Section>

      <Section title="컴포넌트">
        <InteractiveSamples />
      </Section>
    </main>
  );
}
