"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatWon } from "@/lib/format";
import { startCharge } from "./actions";
import { CHARGE_AMOUNTS } from "./charge-schema";

/**
 * 브라우저에서 토스 SDK를 쓰는 유일한 파일. "SDK는 server/providers 안에서만" 규칙의 예외다.
 * 결제창은 브라우저에서만 열 수 있고, 여기 오는 키는 공개용 클라이언트 키뿐이다.
 * 금액을 화면 값으로 정하지 않는다. 서버가 DB에 적고 돌려준 값으로 결제창을 연다.
 */
export function ChargePanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charge(amount: number) {
    setBusy(true);
    setError(null);
    try {
      const started = await startCharge(amount);
      if ("error" in started) {
        setError(started.error);
        return;
      }
      const toss = await loadTossPayments(started.clientKey);
      const { origin } = window.location;
      // 리다이렉트 방식이다. 문서상 Promise 방식은 모바일에서 쓸 수 없다.
      await toss.payment({ customerKey: started.customerKey }).requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: started.amount },
        orderId: started.orderId,
        orderName: started.orderName,
        successUrl: `${origin}/api/payments/confirm`,
        failUrl: `${origin}/billing?result=failed`,
      });
    } catch {
      setError("결제창을 열지 못했어요. 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="충전"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-body font-bold">충전할 금액</h2>
      <div className="flex flex-wrap gap-2">
        {CHARGE_AMOUNTS.map((amount) => (
          <Button
            key={amount}
            variant="secondary"
            disabled={busy}
            onClick={() => void charge(amount)}
          >
            {formatWon(amount)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-status-failed">
          {error}
        </p>
      )}
      <p className="text-caption text-text-muted">
        테스트 결제이며 실제 결제는 이뤄지지 않아요. 충전금은 내 계정 잔액에만
        들어가요.
      </p>
    </section>
  );
}
