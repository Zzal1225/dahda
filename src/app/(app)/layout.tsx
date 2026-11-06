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
      {/* 모바일은 승인함만 대응한다. 표시가 있는 화면에서 안내를 숨기는 규칙은 globals.css에 있다. */}
      <div className="mobile-notice flex min-h-dvh items-center justify-center p-4 text-center md:hidden">
        <div className="flex flex-col gap-2">
          <p className="text-title">PC에서 열어 주세요</p>
          <p className="text-body-sm text-text-muted">
            이 화면은 PC와 태블릿에서 쓸 수 있어요
          </p>
        </div>
      </div>

      <div className="app-shell hidden min-h-dvh flex-col md:flex">
        <Suspense fallback={null}>
          <TrialBanner />
        </Suspense>
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[var(--sidebar-w-collapsed)_minmax(0,1fr)] xl:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]">
          <aside className="hidden flex-col border-r border-border bg-surface md:flex">
            <div className="flex h-(--topbar-h) items-center justify-center border-b border-border text-caption font-bold text-primary xl:justify-start xl:px-6 xl:text-title">
              dahda
            </div>
            <Suspense fallback={<NavFallback />}>
              <SidebarSection />
            </Suspense>
          </aside>
          <div className="flex min-w-0 flex-col">
            <header className="flex h-(--topbar-h) items-center gap-2 border-b border-border bg-surface px-4 whitespace-nowrap md:gap-4 md:px-8">
              <span className="text-title text-primary md:hidden">dahda</span>
              <Suspense fallback={null}>
                <TopBarSection />
              </Suspense>
            </header>
            {/* 넓은 화면에서 본문이 왼쪽에 붙어 오른쪽이 비지 않게 가운데 둔다. 첫 화면만 더 넓게 쓰는 규칙은 globals.css. */}
            <main className="mx-auto flex w-full max-w-(--content-max) flex-col gap-5 p-4 md:p-8">
              <QueryProvider>{children}</QueryProvider>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
