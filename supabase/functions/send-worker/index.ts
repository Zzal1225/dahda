// pg_cron이 10초마다 깨우는 워커. 판단과 저장은 src/server/queue에 있고, 여기서는 Deno 환경에 맞춰 연결만 한다.
// Vercel 함수 대신 Edge Function을 쓰는 이유는 기획서 "발송 큐와 재시도"에 있다.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createFakeProvider } from "../../../src/server/providers/fake/fake-provider.ts";
import {
  createGuardedProvider,
  parseAllowedRecipients,
  allowDemoRequest,
  allowRecipients,
  usesRealDemo,
  usesRealProvider,
} from "../../../src/server/providers/guarded-provider.ts";
import { createSolapiClient } from "../../../src/server/providers/solapi/solapi-client.ts";
import { createSolapiProvider } from "../../../src/server/providers/solapi/solapi-provider.ts";
import type { SmsProvider } from "../../../src/server/providers/sms-provider.ts";
import { createSupabaseQueueStore } from "../../../src/server/queue/supabase-store.ts";
import {
  DEFAULT_RESULT_TIMEOUT_MS,
  runReconcileTick,
} from "../../../src/server/queue/reconcile.ts";
import { runWorkerTick } from "../../../src/server/queue/worker.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// 측정 3: 10초마다 한 묶음이라 100이면 1만 건에 약 17분, 500이면 약 3분이다.
// 솔라피는 호출당 1만 건, 5초에 100회까지 받으므로 500은 제한에 닿지 않는다(docs/decisions 솔라피 연동).
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_DAILY_LIMIT = 10;
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

    const supabase = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const smsProvider = Deno.env.get("SMS_PROVIDER");
    // 필요할 때만 만든다. 키가 없는 환경에서 체험 계정 발송까지 막히면 안 된다.
    let solapi: SmsProvider | undefined;
    const solapiProvider = () => {
      solapi ??= createSolapiProvider({
        webhookSecret: required("SOLAPI_WEBHOOK_SECRET"),
        client: createSolapiClient(
          required("SOLAPI_API_KEY"),
          required("SOLAPI_API_SECRET"),
        ),
      });
      return solapi;
    };
    // 두 경로가 같은 카운터를 쓴다. 경로가 늘어도 하루에 나가는 실제 문자의 총량은 늘지 않는다.
    const guard = {
      dailyLimit: Number(
        Deno.env.get("SOLAPI_DAILY_LIMIT") ?? DEFAULT_DAILY_LIMIT,
      ),
      reserve: async (count: number, limit: number) => {
        const { data, error } = await supabase.rpc("reserve_real_sends", {
          p_count: count,
          p_limit: limit,
        });
        if (error) throw error;
        return data;
      },
    };
    let real: SmsProvider | undefined;
    const realProvider = () => {
      real ??= createGuardedProvider(solapiProvider(), {
        ...guard,
        isAllowed: allowRecipients(
          parseAllowedRecipients(Deno.env.get("SOLAPI_ALLOWED_RECIPIENTS")),
        ),
      });
      return real;
    };
    let demo: SmsProvider | undefined;
    const demoProvider = () => {
      demo ??= createGuardedProvider(solapiProvider(), {
        ...guard,
        isAllowed: allowDemoRequest(Deno.env.get("DEMO_SENDER_NUMBER")),
      });
      return demo;
    };

    // pg_cron이 10분마다 따로 부른다. 키와 어댑터를 한 곳에 두려고 함수를 나누지 않았다.
    const { task } = (await request.json().catch(() => ({}))) as {
      task?: string;
    };
    if (task === "reconcile") {
      const hours = Number(Deno.env.get("RESULT_TIMEOUT_HOURS"));
      return Response.json(
        await runReconcileTick({
          store: createSupabaseQueueStore(supabase),
          providerFor: (name) => (name === "solapi" ? solapiProvider() : null),
          resultTimeoutMs:
            hours > 0 ? hours * 3_600_000 : DEFAULT_RESULT_TIMEOUT_MS,
        }),
      );
    }

    const summary = await runWorkerTick({
      store: createSupabaseQueueStore(supabase),
      providerFor: (message) => {
        if (usesRealDemo({ isRealDemo: message.isRealDemo, smsProvider })) {
          return demoProvider();
        }
        return usesRealProvider({ isTrial: message.isTrial, smsProvider })
          ? realProvider()
          : fake;
      },
      batchSize: Number(Deno.env.get("SEND_BATCH_SIZE") ?? DEFAULT_BATCH_SIZE),
      leaseSeconds: LEASE_SECONDS,
    });
    return Response.json(summary);
  } catch (error) {
    console.error("워커 실패", error);
    return new Response("worker failed", { status: 500 });
  }
});
