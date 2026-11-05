import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/server/db/database.types";
import { createFakeProvider } from "../src/server/providers/fake/fake-provider";
import { createSupabaseQueueStore } from "../src/server/queue/supabase-store";
import { runWorkerTick } from "../src/server/queue/worker";

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

/** 워커를 돌리고 결과 웹훅이 앱에 모두 도착할 때까지 기다린다. */
async function runWorker(failureRate: number) {
  const deliveries: Promise<unknown>[] = [];
  const fake = createFakeProvider({
    secret: env.FAKE_WEBHOOK_SECRET ?? "",
    failureRate,
    // 화면이 "확인 중"을 지나는지 보려고 결과를 조금 늦춘다.
    minDelayMs: 1500,
    maxDelayMs: 1500,
    deliver: async (webhook) => {
      const delivery = fetch("http://127.0.0.1:3000/api/webhooks/sms/fake", {
        method: "POST",
        headers: webhook.headers,
        body: webhook.rawBody,
      });
      deliveries.push(delivery);
      await delivery;
    },
    onDeliveryError: () => {},
  });
  const summary = await runWorkerTick({
    store: createSupabaseQueueStore(service),
    providerFor: () => fake,
    batchSize: 1000,
    leaseSeconds: 300,
  });
  return summary;
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

test.describe("실시간 진행률", () => {
  test("새로고침 없이 확인 중을 거쳐 완료까지 바뀐다", async ({ page }) => {
    await sendNow(page, "성수점", "실시간 확인");
    await expect(selectedRow(page)).toContainText("예약");
    // 구독이 연결되기 전 변경은 재접속 맞춤으로 처리되지만, 여기서는 구독 경로를 보려고 기다린다.
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      Object.assign(window, { __noReload: true });
    });

    await runWorker(0);

    await expect(selectedRow(page)).toContainText("확인 중");
    await expect(page.getByText(/실시간 갱신 중/)).toBeVisible();
    await expect(selectedRow(page)).toContainText("완료", { timeout: 8000 });
    await expect(page.getByText("결과 확정")).toBeVisible();
    await expect(page.getByText(/실시간 갱신 중/)).toHaveCount(0);

    // 수신자 표도 함께 바뀐다.
    await expect(
      page
        .getByRole("table", { name: "수신자별 결과" })
        .getByText("도착")
        .first(),
    ).toBeVisible();

    expect(
      await page.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload,
      ),
    ).toBe(true);
  });

  test("실패분 환불이 새로고침 없이 상단 잔액에 반영된다", async ({ page }) => {
    await sendNow(page, "망원점", "환불 반영");
    await expect(page.getByRole("banner")).not.toContainText("₩1,310,400");
    await page.waitForTimeout(1500);

    await runWorker(1);

    await expect(selectedRow(page)).toContainText("발송 실패", {
      timeout: 8000,
    });
    await expect(page.getByRole("banner")).toContainText("₩1,310,400", {
      timeout: 15_000,
    });
  });
});

test.describe("구독이 끊긴 경우", () => {
  test("10초 폴링으로 넘어가 화면이 멈추지 않는다", async ({ page }) => {
    // 소켓을 받자마자 끊는다. 재접속도 계속 실패한다.
    await page.routeWebSocket(/realtime/, (socket) => socket.close());
    await sendNow(page, "성수점", "끊김 확인");
    await page.waitForTimeout(1500);

    await runWorker(0);

    // 소켓이 없으니 폴링만이 이 값을 가져올 수 있다.
    await expect(selectedRow(page)).toContainText("완료", { timeout: 15_000 });
  });
});

test.describe("실패 건 재발송", () => {
  test("실패 행을 다시 보내면 새 발송 건이 생기고 원본은 그대로다", async ({
    page,
  }) => {
    await sendNow(page, "합정점", "재발송 확인");
    await page.waitForTimeout(1000);
    await runWorker(1);
    await expect(selectedRow(page)).toContainText("발송 실패", {
      timeout: 8000,
    });

    const recipients = page.getByRole("table", { name: "수신자별 결과" });
    const checkboxes = recipients.getByRole("checkbox", { name: /\d 선택$/ });
    await expect(checkboxes.nth(1)).toBeVisible();
    // 표 순서가 아니라 번호로 고른다. 돌아와서 같은 사람을 확인해야 하기 때문이다.
    const firstLabel =
      (await checkboxes.nth(0).getAttribute("aria-label")) ?? "";
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    const bar = page.getByRole("region", { name: "선택한 수신자" });
    await expect(bar).toContainText("2건 선택");
    const before = await page.getByRole("banner").innerText();
    await bar.getByRole("button", { name: "실패 2건 재발송" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("실패 2건을 다시 보낼까요?");
    await expect(dialog).toContainText("재발송 대상 2건");
    await dialog.getByRole("button", { name: "2건 재발송" }).click();

    await expect(dialog).toBeHidden();
    await expect(selectedRow(page)).toContainText("재발송");
    await expect(selectedRow(page)).toContainText("예약");
    await expect(page.getByRole("banner")).not.toHaveText(before);

    const table = page.getByRole("table", { name: "발송 건" });
    const rows = table.getByRole("row", { name: /재발송 확인/ });
    await expect(rows).toHaveCount(2);

    // 원본으로 돌아가 같은 행을 고르면 이미 보낸 건이라 대상이 없다.
    await rows.nth(1).click();
    await expect(selectedRow(page)).toContainText("발송 실패");
    await page
      .getByRole("table", { name: "수신자별 결과" })
      .getByRole("checkbox", { name: firstLabel, exact: true })
      .check();
    await expect(
      page
        .getByRole("region", { name: "선택한 수신자" })
        .getByRole("button", { name: "재발송할 실패 건 없음" }),
    ).toBeDisabled();
  });

  test("도착한 행만 고르면 재발송할 수 없다", async ({ page }) => {
    await sendNow(page, "성수점", "도착만");
    await page.waitForTimeout(1000);
    await runWorker(0);
    await expect(selectedRow(page)).toContainText("완료", { timeout: 8000 });

    await page
      .getByRole("table", { name: "수신자별 결과" })
      .getByRole("checkbox", { name: /\d 선택$/ })
      .first()
      .check();

    await expect(
      page.getByRole("button", { name: "재발송할 실패 건 없음" }),
    ).toBeDisabled();
  });
});
