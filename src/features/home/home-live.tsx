"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useLiveCampaigns } from "@/features/campaigns/use-live-campaigns";
import { createThrottle } from "@/lib/throttle";

const REFRESH_MS = 2_000;
const FALLBACK_POLL_MS = 10_000;

/**
 * 변경 신호를 받으면 서버 화면을 다시 그린다. 숫자를 브라우저에서 따로 계산하면 서버 계산과 두 벌이 된다.
 * 발송 건 하나의 변경이 초당 여러 번 오므로 묶는다. 안 그러면 대량 발송 중 화면을 계속 다시 그린다.
 * 연결이 안 되면 진행 중인 건이 있을 때만 폴링한다. "실시간 갱신"이라고 적어 놓고 멈춰 있으면 안 된다.
 */
export function HomeLive({
  filter,
  hasActive,
}: {
  filter: string;
  hasActive: boolean;
}) {
  const router = useRouter();
  const throttle = useMemo(
    () => createThrottle(() => router.refresh(), REFRESH_MS),
    [router],
  );
  useEffect(() => () => throttle.cancel(), [throttle]);

  const status = useLiveCampaigns(filter, () => throttle.call());

  useEffect(() => {
    if (status === "live" || !hasActive) return;
    const timer = setInterval(() => router.refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [status, hasActive, router]);

  return (
    <span className="text-caption text-text-muted">
      {status === "live" ? "실시간 갱신" : "10초마다 갱신"}
    </span>
  );
}
