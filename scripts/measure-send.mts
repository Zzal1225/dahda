// 측정 3: 1만 건 발송 처리 시간과 묶음 크기. docs/performance.md의 수치를 만든다.
//
// 준비: npx supabase start → npm run build → npm run start
// 실행: node --env-file=.env.local scripts/measure-send.mts [묶음 크기] [건수=10000] [웹훅 동시 수=20]
//
// 워커를 쉬지 않고 돌려 처리 능력을 잰다. 실제로는 cron이 10초마다 깨우므로 그 조건의 값은 따로 계산해 출력한다.
// 결과 웹훅은 실제 앱 경로로 받는다. 시간은 DB에 남은 값(접수, 마지막 sent, 완료)의 차이다.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/server/db/database.types.ts";
import { createFakeProvider } from "../src/server/providers/fake/fake-provider.ts";
import { createSupabaseQueueStore } from "../src/server/queue/supabase-store.ts";
import { runWorkerTick } from "../src/server/queue/worker.ts";

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:3000";
const BATCH = Number(process.argv[2] ?? 100);
const COUNT = Number(process.argv[3] ?? 10_000);
const WEBHOOK_CONCURRENCY = Number(process.argv[4] ?? 20);
const CRON_INTERVAL_S = 10;

const service = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const created = await service.auth.admin.createUser({
  email: `measure-send-${Date.now()}@example.com`,
  password: "measure-password",
  email_confirm: true,
});
if (created.error) throw created.error;
const userId = created.data.user.id;
const trial = await service.rpc("create_trial_org", { p_user_id: userId });
if (trial.error) throw trial.error;
const member = await service
  .from("members")
  .select("org_id")
  .eq("user_id", userId)
  .single();
if (member.error) throw member.error;

// 앞선 실행의 대기 행이 섞이면 시간이 부풀려진다.
await service.from("messages").delete().eq("status", "queued");

const campaign = await service.rpc("submit_campaign", {
  p_client_request_id: randomUUID(),
  p_org_id: member.data.org_id,
  p_branch_id: null as unknown as string,
  p_created_by: userId,
  p_body: "측정 3",
  p_kind: "sms",
  p_is_ad: false,
  p_sender_phone: "0212345678",
  p_status: "scheduled",
  p_scheduled_at: null as unknown as string,
  p_unit_price: 1,
  p_recipients: Array.from({ length: COUNT }, (_, index) => ({
    phone: `0102${String(1000000 + index).padStart(7, "0")}`,
    name: null,
  })),
});
if (campaign.error) throw campaign.error;
const campaignId = campaign.data;

// 웹훅을 한꺼번에 쏘면 앱 처리량이 아니라 연결 수를 재게 된다. 동시 수를 묶는다.
const waiting: (() => void)[] = [];
let active = 0;
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= WEBHOOK_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

let webhookErrors = 0;
const pendingDeliveries: Promise<unknown>[] = [];
const fake = createFakeProvider({
  secret: process.env.FAKE_WEBHOOK_SECRET ?? "",
  deliver: async (webhook) => {
    const response = await limited(() =>
      fetch(`${BASE}/api/webhooks/sms/fake`, {
        method: "POST",
        headers: webhook.headers,
        body: webhook.rawBody,
      }),
    );
    if (response.status !== 200) webhookErrors += 1;
  },
  onDeliveryError: () => {
    webhookErrors += 1;
  },
  // 업체의 1~5초 대기는 묶음 크기와 무관한 시간이라 뺀다.
  schedule: (run) => {
    pendingDeliveries.push(Promise.resolve().then(run));
  },
});

const store = createSupabaseQueueStore(service);
let ticks = 0;
for (;;) {
  const summary = await runWorkerTick({
    store,
    providerFor: () => fake,
    batchSize: BATCH,
    leaseSeconds: 300,
  });
  if (summary.claimed === 0) break;
  ticks += 1;
}

// 완료될 때까지 기다린다. 웹훅이 모두 처리되면 DB에 완료 시각이 남는다.
for (;;) {
  const row = await service
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();
  if (row.data?.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const row = await service
  .from("campaigns")
  .select("created_at, completed_at, delivered_count, failed_count")
  .eq("id", campaignId)
  .single();
if (row.error) throw row.error;
const lastSent = await service
  .from("messages")
  .select("sent_at")
  .eq("campaign_id", campaignId)
  .order("sent_at", { ascending: false, nullsFirst: false })
  .limit(1)
  .single();
if (lastSent.error) throw lastSent.error;

const start = new Date(row.data.created_at).getTime();
const sendMs = new Date(lastSent.data.sent_at ?? 0).getTime() - start;
const totalMs = new Date(row.data.completed_at ?? 0).getTime() - start;

console.log(
  JSON.stringify({
    batch: BATCH,
    count: COUNT,
    ticks,
    sendMs,
    totalMs,
    perSecond: Math.round((COUNT / sendMs) * 1000),
    // 10초마다 한 묶음만 처리할 때의 계산값이다. 잰 값이 아니다.
    cronLimitedSeconds: Math.ceil(COUNT / BATCH) * CRON_INTERVAL_S,
    delivered: row.data.delivered_count,
    failed: row.data.failed_count,
    webhookErrors,
  }),
);
