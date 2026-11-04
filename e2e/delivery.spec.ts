import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/server/db/database.types";
import { createFakeProvider } from "../src/server/providers/fake/fake-provider";
import { createSupabaseQueueStore } from "../src/server/queue/supabase-store";
import { runWorkerTick } from "../src/server/queue/worker";

// Edge Function과 cron은 CI에서 띄우지 않는다. 워커 코드를 여기서 직접 돌리고, 웹훅은 실제 앱 경로로 받는다.
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const service = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  env.SUPABASE_SECRET_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const WEBHOOK_URL = "http://127.0.0.1:3000/api/webhooks/sms/fake";

/** 메시지를 보내고, 가짜 발송기의 서명 웹훅이 모두 앱에 도착할 때까지 기다린다. */
async function runWorker(failureRate: number) {
  const deliveries: Promise<unknown>[] = [];
  const scheduled: Promise<unknown>[] = [];
  const errors: unknown[] = [];
  const fake = createFakeProvider({
    secret: env.FAKE_WEBHOOK_SECRET ?? "",
    failureRate,
    deliver: async (webhook) => {
      const delivery = fetch(WEBHOOK_URL, {
        method: "POST",
        headers: webhook.headers,
        body: webhook.rawBody,
      });
      deliveries.push(delivery);
      const response = await delivery;
      expect(response.status).toBe(200);
    },
    onDeliveryError: (error) => void errors.push(error),
    schedule: (run) => {
      scheduled.push(Promise.resolve().then(run));
    },
  });
  const summary = await runWorkerTick({
    store: createSupabaseQueueStore(service),
    providerFor: () => fake,
    batchSize: 1000,
    leaseSeconds: 300,
  });
  expect(summary.claimed).toBeGreaterThan(0);
  await Promise.all(scheduled);
  await expect
    .poll(() => deliveries.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(summary.accepted);
  await Promise.all(deliveries);
  expect(errors).toEqual([]);
  // 응답을 받은 뒤 저장이 끝나 있어야 하므로 추가 대기가 필요 없다.
}

async function sendNow(page: Page, branch: string, text: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name: `지점 · ${branch}` }).click();
  await expect(page.getByRole("banner")).toContainText(branch);
  await page.goto("/compose");
  await page.getByRole("checkbox", { name: /신규 손님/ }).check();
  await page.getByRole("textbox", { name: "보낼 내용" }).fill(text);
  await expect(
    page.getByRole("status").filter({ hasText: "총" }),
  ).toContainText("명");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /건 보내기/ })
    .click();
  await expect(page).toHaveURL(/\/history\?campaign=/);
}

const selectedRow = (page: Page) =>
  page
    .getByRole("table", { name: "발송 건" })
    .getByRole("row", { selected: true });

test.describe("발송 결과", () => {
  test("모두 도착하면 완료되고 차감은 그대로다", async ({ page }) => {
    await sendNow(page, "성수점", "도착 확인");
    await expect(page.getByRole("banner")).not.toContainText("₩2,000,000");
    const charged = (await page.getByRole("banner").innerText()).match(
      /₩[\d,]+/,
    )?.[0];

    await runWorker(0);

    await page.reload();
    await expect(selectedRow(page)).toContainText("완료");
    await expect(page.getByRole("banner")).toContainText(charged ?? "없음");
  });

  test("모두 실패하면 완료되고 실패분이 돌아온다", async ({ page }) => {
    await sendNow(page, "성수점", "실패 확인");
    await expect(page.getByRole("banner")).not.toContainText("₩2,000,000");

    await runWorker(1);

    await page.reload();
    await expect(selectedRow(page)).toContainText("완료");
    await expect(page.getByRole("banner")).toContainText("₩2,000,000");
  });
});

test.describe("웹훅 경로", () => {
  test("로그인 화면으로 보내지 않고 서명 없는 요청을 거부한다", async ({
    request,
  }) => {
    const response = await request.post("/api/webhooks/sms/fake", {
      data: { events: [] },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
  });

  test("모르는 업체는 404다", async ({ request }) => {
    const response = await request.post("/api/webhooks/sms/nope", {
      data: {},
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test("너무 큰 요청은 저장하지 않고 거부한다", async ({ request }) => {
    const response = await request.post("/api/webhooks/sms/fake", {
      data: "x".repeat(300 * 1024),
      headers: { "content-type": "text/plain" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(413);
  });
});
