"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  // 렌더 밖에 두면 서버에서 사용자 간에 캐시가 공유될 수 있어 컴포넌트 안에서 한 번만 만든다.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 발송 결과는 바뀌는 데이터지만, 탭을 오갈 때마다 다시 받으면 10만 행 표에서 낭비가 크다.
            // 실시간 반영은 step4에서 Realtime과 무효화로 처리한다.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
