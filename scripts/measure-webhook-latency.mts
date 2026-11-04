// 측정 4: 웹훅 도착부터 화면 갱신까지의 지연. docs/performance.md의 수치를 만든다.
//
// 준비: npx supabase start → npm run build → npm run start
// 실행: node --env-file=.env.local scripts/measure-webhook-latency.mts [표본 수=100]
//
// 측정 계정을 새로 만들고 웹훅을 하나씩 보낸다. 서명은 실제와 같고 경로도 실제 앱이다.
// 표본마다 폴링 주기 전체(0~10초)에서 임의로 쉰다. 화면 갱신 직후에 짧게 쉬고 보내면 웹훅이 항상 주기 앞쪽에 몰려
// 지연이 부풀려진다(처음 측정에서 중앙값 8.5초, 최솟값 7초로 드러났다). Realtime 측정에도 같은 조건을 쓴다.
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/server/db/database.types.ts";
import {
  createFakeProvider,
  signFakeWebhook,
} from "../src/server/providers/fake/fake-provider.ts";
import type {
  SendResult,
  SmsProvider,
} from "../src/server/providers/sms-provider.ts";
import { createSupabaseQueueStore } from "../src/server/queue/supabase-store.ts";
import { runWorkerTick } from "../src/server/queue/worker.ts";

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:3000";
const SAMPLES = Number(process.argv[2] ?? 100);
const SECRET = process.env.FAKE_WEBHOOK_SECRET ?? "";
const PASSWORD = "measure-password";
const MAX_WAIT_MS = 30_000;
const SAMPLE_GAP_MS = 10_000;

const service = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted: readonly number[], ratio: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;

async function setup() {
  const email = `measure-${Date.now()}@example.com`;
  const created = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
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

  const campaign = await service.rpc("submit_campaign", {
    p_client_request_id: randomUUID(),
    p_org_id: member.data.org_id,
    p_branch_id: null as unknown as string,
    p_created_by: userId,
    p_body: "측정 4",
    p_kind: "sms",
    p_is_ad: false,
    p_sender_phone: "0212345678",
    p_status: "scheduled",
    p_scheduled_at: null as unknown as string,
    p_unit_price: 1,
    p_recipients: Array.from({ length: SAMPLES + 1 }, (_, index) => ({
      phone: `0100${String(1000000 + index).padStart(7, "0")}`,
      name: null,
    })),
  });
  if (campaign.error) throw campaign.error;
  return { email, campaignId: campaign.data };
}

/** 메시지를 접수 상태로 만든다. 결과 웹훅은 측정 구간에서 하나씩 직접 보낸다. */
async function accept(campaignId: string) {
  const accepting: SmsProvider = {
    ...createFakeProvider({
      secret: SECRET,
      deliver: async () => {},
      onDeliveryError: () => {},
    }),
    send: async (batch) =>
      batch.map((request): SendResult => ({
        idempotencyKey: request.idempotencyKey,
        outcome: "accepted",
        providerMessageId: `fake-${request.idempotencyKey}`,
      })),
  };
  await runWorkerTick({
    store: createSupabaseQueueStore(service),
    providerFor: () => accepting,
    batchSize: SAMPLES + 1,
    leaseSeconds: 300,
  });
  const messages = await service
    .from("messages")
    .select("idempotency_key")
    .eq("campaign_id", campaignId)
    .order("id");
  if (messages.error) throw messages.error;
  return messages.data.map((row) => row.idempotency_key);
}

async function postDelivered(key: string) {
  const signed = await signFakeWebhook(
    SECRET,
    JSON.stringify({
      events: [
        {
          status: "delivered",
          providerMessageId: `fake-${key}`,
          idempotencyKey: key,
          occurredAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const response = await fetch(`${BASE}/api/webhooks/sms/fake`, {
    method: "POST",
    headers: signed.headers,
    body: signed.rawBody,
  });
  if (response.status !== 200) {
    throw new Error(`웹훅 응답 ${response.status}`);
  }
}

const { email, campaignId } = await setup();
const keys = await accept(campaignId);

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 800 } })
).newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel("이메일").fill(email);
await page.getByLabel("비밀번호").fill(PASSWORD);
await page.getByRole("button", { name: "로그인", exact: true }).click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/history?campaign=${campaignId}`);
await page.getByRole("row", { selected: true }).first().waitFor();

// 화면 안에서 프레임마다 도착 건수를 읽어, 처음 보인 시각을 남긴다.
// Node에서 묻는 방식은 왕복 시간이 지연에 섞인다. 같은 PC라 시계는 같다.
await page.evaluate(() => {
  const seen: Record<number, number> = {};
  Object.assign(window, { __seen: seen });
  const read = () => {
    const label = document
      .querySelector('[role="row"][aria-selected="true"] [role="img"]')
      ?.getAttribute("aria-label");
    const match = label?.match(/도착 (\d+)건/);
    if (match?.[1]) {
      const count = Number(match[1]);
      seen[count] ??= Date.now();
    }
    requestAnimationFrame(read);
  };
  read();
});

const latencies: number[] = [];
// 마지막 한 건은 보내지 않는다. 완료되면 화면이 갱신을 멈춰, 완료 처리 비용이 표본에 섞인다.
for (const [index, key] of keys.slice(0, SAMPLES).entries()) {
  await sleep(Math.random() * SAMPLE_GAP_MS);
  const target = index + 1;
  const sentAt = Date.now();
  await postDelivered(key);

  const deadline = sentAt + MAX_WAIT_MS;
  let shownAt: number | undefined;
  while (Date.now() < deadline) {
    shownAt = await page.evaluate(
      (count) =>
        (window as unknown as { __seen: Record<number, number> }).__seen[count],
      target,
    );
    if (shownAt !== undefined) break;
    await sleep(20);
  }
  if (shownAt === undefined) throw new Error(`${target}번째 표본 시간 초과`);
  latencies.push(shownAt - sentAt);
  if (target % 10 === 0) console.error(`${target}/${SAMPLES}`);
}
await browser.close();

const sorted = [...latencies].sort((a, b) => a - b);
console.log(
  JSON.stringify({
    samples: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  }),
);
