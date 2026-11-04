import { Suspense } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import {
  SidebarSection,
  TopBarSection,
  TrialBanner,
} from "@/components/shell/shell-sections";

function NavFallback() {
  return (
    <div aria-hidden className="flex flex-col gap-2 p-1.5 xl:p-3">
      <div className="h-10 rounded-md bg-skeleton" />
      <div className="h-10 rounded-md bg-skeleton" />
    </div>
  );
}

// 세션을 기다리지 않는다. 사이드바와 상단 바의 틀은 정적 셸로 바로 나가고, 내용만 각 Suspense에서 이어진다.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* 모바일은 승인함만 대응한다. 승인함을 만드는 step3에서 그 경로를 이 안내의 예외로 둔다. */}
      <div className="flex min-h-dvh items-center justify-center p-4 text-center md:hidden">
        <div className="flex flex-col gap-2">
          <p className="text-title">PC에서 열어 주세요</p>
          <p className="text-body-sm text-text-muted">
            이 화면은 PC와 태블릿에서 쓸 수 있어요
          </p>
        </div>
      </div>

      <div className="hidden min-h-dvh flex-col md:flex">
        <Suspense fallback={null}>
          <TrialBanner />
        </Suspense>
        <div className="grid flex-1 grid-cols-[var(--sidebar-w-collapsed)_minmax(0,1fr)] xl:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]">
          <aside className="flex flex-col border-r border-border bg-surface">
            <div className="flex h-(--topbar-h) items-center justify-center border-b border-border text-caption font-bold text-primary xl:justify-start xl:px-6 xl:text-title">
              dahda
            </div>
            <Suspense fallback={<NavFallback />}>
              <SidebarSection />
            </Suspense>
          </aside>
          <div className="flex min-w-0 flex-col">
            <header className="flex h-(--topbar-h) items-center gap-4 border-b border-border bg-surface px-8 whitespace-nowrap">
              <Suspense fallback={null}>
                <TopBarSection />
              </Suspense>
            </header>
            <main className="flex w-full max-w-(--content-max) flex-col gap-5 p-8">
              <QueryProvider>{children}</QueryProvider>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
