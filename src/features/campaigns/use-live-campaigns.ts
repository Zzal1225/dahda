"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";
import type { Database } from "@/server/db/database.types";

export type LiveStatus = "connecting" | "live" | "offline";

/** null이면 어떤 행이 바뀌었는지 모른다. 재접속 직후처럼 전부 다시 읽어야 하는 경우다. */
export type LiveChange = { id: string; status: string } | null;

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

function browserClient() {
  // 탭마다 연결은 하나면 된다. 화면을 오갈 때마다 만들면 소켓이 쌓인다.
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  );
  return client;
}

/**
 * 발송 건 변경을 구독한다. 값을 화면에 직접 넣지 않고 "바뀌었다"는 신호로만 쓴다.
 * 표의 값은 항상 서버 조회 한 경로로 만들어야 열 이름 변환과 비용 계산이 두 벌이 되지 않는다.
 *
 * filter는 편의다. 실제 경계는 RLS이고, 구독자가 볼 수 없는 행의 변경은 오지 않는다.
 */
export function useLiveCampaigns(
  filter: string,
  onChange: (change: LiveChange) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = browserClient();
    let cancelled = false;
    let cleanup = () => {};

    async function connect() {
      // 세션이 쿠키에 있어도 소켓에는 자동으로 실리지 않는다. 토큰 없이 접속하면 비로그인 권한이라 구독이 거부된다.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      const channel = supabase
        .channel(`campaigns:${filter}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "campaigns", filter },
          (payload) => {
            const row = payload.new as { id?: string; status?: string };
            if (row.id && row.status) {
              handler.current({ id: row.id, status: row.status });
            }
          },
        )
        // 구독 거부는 subscribe 상태로 오지 않는다. 이 신호를 놓치면 "연결됨"인 채 화면이 멈춘다.
        .on("system", {}, (payload: { status?: string }) => {
          if (payload.status === "error") setStatus("offline");
        })
        .subscribe((state) => {
          if (state === "SUBSCRIBED") {
            setStatus("live");
            // 연결이 끊긴 동안의 변경은 다시 오지 않으므로 연결될 때마다 맞춘다.
            handler.current(null);
          } else if (
            state === "CHANNEL_ERROR" ||
            state === "TIMED_OUT" ||
            state === "CLOSED"
          ) {
            setStatus("offline");
          }
        });
      cleanup = () => void supabase.removeChannel(channel);
    }

    connect().catch(() => setStatus("offline"));

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [filter]);

  return status;
}
