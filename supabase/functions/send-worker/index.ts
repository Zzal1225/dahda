// pg_cron이 10초마다 깨우는 워커. 판단과 저장은 src/server/queue에 있고, 여기서는 Deno 환경에 맞춰 연결만 한다.
// Vercel 함수 대신 Edge Function을 쓰는 이유는 기획서 "발송 큐와 재시도"에 있다.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createFakeProvider } from "../../../src/server/providers/fake/fake-provider.ts";
import { createSupabaseQueueStore } from "../../../src/server/queue/supabase-store.ts";
import { runWorkerTick } from "../../../src/server/queue/worker.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const DEFAULT_BATCH_SIZE = 100; // 확인 필요: 솔라피 초당 제한을 확인한 뒤 4-4에서 조정한다.
const LEASE_SECONDS = 300;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} 환경 변수가 없다`);
  return value;
}

/** 일치하는 앞부분 길이가 응답 시간으로 드러나지 않게 끝까지 비교한다. */
function secretMatches(actual: string, expected: string): boolean {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get("WORKER_SECRET");
  // 비밀값이 비어 있으면 닫는다. 누구나 깨울 수 있으면 예약 전 발송은 막아도 호출 비용을 막지 못한다.
  if (
    !secret ||
    !secretMatches(request.headers.get("x-worker-secret") ?? "", secret)
  ) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const fake = createFakeProvider({
      secret: required("FAKE_WEBHOOK_SECRET"),
      deliver: (webhook) => {
        const delivery = fetch(`${required("APP_URL")}/api/webhooks/sms/fake`, {
          method: "POST",
          headers: webhook.headers,
          body: webhook.rawBody,
        });
        EdgeRuntime.waitUntil(delivery);
        return delivery.then(() => undefined);
      },
      onDeliveryError: (error) => console.error("가짜 웹훅 전달 실패", error),
      // 응답을 보낸 뒤에도 1~5초 뒤의 결과 통보가 끊기지 않게 런타임에 알린다.
      schedule: (run, delayMs) => {
        EdgeRuntime.waitUntil(
          new Promise<void>((resolve) =>
            setTimeout(() => {
              run();
              resolve();
            }, delayMs),
          ),
        );
      },
    });

    const summary = await runWorkerTick({
      store: createSupabaseQueueStore(
        createClient(
          required("SUPABASE_URL"),
          required("SUPABASE_SERVICE_ROLE_KEY"),
          { auth: { persistSession: false, autoRefreshToken: false } },
        ),
      ),
      // 실제 업체는 4-4에서 연결한다. 그 전까지 모든 계정이 가짜 발송기라 실제 문자는 나갈 수 없다.
      providerFor: () => fake,
      batchSize: Number(Deno.env.get("SEND_BATCH_SIZE") ?? DEFAULT_BATCH_SIZE),
      leaseSeconds: LEASE_SECONDS,
    });
    return Response.json(summary);
  } catch (error) {
    console.error("워커 실패", error);
    return new Response("worker failed", { status: 500 });
  }
});
