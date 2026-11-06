// README 캡처(docs/assets)를 다시 만든다. 체험 계정으로 들어가 화면을 연다.
// 실행: npm run dev 를 띄운 뒤 node scripts/capture-docs.mjs [주소, 기본 http://127.0.0.1:3000]
// 손으로 찍으면 다음 변경 때 같은 화면을 다시 만들 수 없어 스크립트로 둔다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
// 로컬 Supabase만 읽는다(체험 샘플의 기록 찾기). .env.local의 비밀 키를 쓰고 화면에는 내보내지 않는다.
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const OUT = new URL("../docs/assets/", import.meta.url);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function shot(name, locator) {
  const target = locator ?? page;
  await target.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)) });
  console.log(`docs/assets/${name}.png`);
}

async function switchTo(name) {
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name }).click();
}

await page.goto(`${BASE}/login`);
await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
await page.getByRole("note").waitFor();

// 1. 발송 건 상태: 승인 대기·예약·반려와 진행 숫자
await page.goto(`${BASE}/history`);
await page
  .getByRole("table", { name: "발송 건" })
  .getByRole("row")
  // 머리글 + 샘플 발송 건 10건(보낸 7 + 승인 대기·반려·예약). 마지막 행까지 그려진 뒤 찍는다.
  .nth(10)
  .waitFor();
await shot("history-states", page.locator("main"));

// 2. 수신자 기록: 결과 웹훅이 접수 기록보다 먼저 온 행
// 샘플 수신자는 주소록 사람(무작위 번호)이라 그런 기록이 있는 번호를 DB에서 찾는다.
await page
  .getByRole("table", { name: "발송 건" })
  .getByRole("row", { name: /성수점 \[주차장 공사/ })
  .click();
await page.waitForURL(/campaign=/);
const campaignId = new URL(page.url()).searchParams.get("campaign");
const { data: late, error: lateError } = await service
  .from("message_events")
  .select("messages!inner(phone, campaign_id)")
  .eq("outcome", "recorded_late")
  .eq("messages.campaign_id", campaignId)
  .limit(1)
  .single();
if (lateError) throw new Error(lateError.message);
const latePhone = late.messages.phone;
await page.getByRole("searchbox", { name: "수신번호 검색" }).fill(latePhone);
await page.waitForURL(new RegExp(`q=${latePhone}`));
await page
  .getByRole("button", {
    name: `${latePhone.slice(0, 3)}-${latePhone.slice(3, 7)}-${latePhone.slice(7)} 기록 보기`,
  })
  .click();
await page.getByRole("list", { name: "수신자 기록" }).waitFor();
await shot("message-events", page.getByRole("dialog"));
await page.keyboard.press("Escape");

// 3. 10만 행 샘플: 한 스크롤 가상화와 "그린 행"
await page.goto(`${BASE}/history/sample`);
await page.getByText(/그린 행/).waitFor();
await page.locator("[data-row]").first().waitFor();
await shot("sample-100k", page.locator("main"));

// 4. 주소록: 왼쪽 그룹 목록 + 가린 번호 + 수신 상태
await switchTo(/지점 · 성수점/);
await page.getByRole("banner").getByText("성수점").waitFor();
await page.goto(`${BASE}/contacts`);
await page.getByRole("table", { name: "연락처" }).locator("[data-row]").first().waitFor();
await shot("contacts", page.locator("main"));

// 5. 엑셀 업로드: 체험용 샘플(1만 행) → 열 매핑 → 결과 요약(추가·중복·형식 오류·수신거부 제외·처리 시간)
await page.getByRole("button", { name: "엑셀 업로드" }).click();
await page.getByRole("button", { name: "파일 선택" }).waitFor();
const sample = await page.request.get(`${BASE}/api/contacts/sample`);
await page.getByLabel("업로드할 파일").setInputFiles({
  name: "체험용-샘플-1만행.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await sample.body()),
});
await page.getByRole("table", { name: "첫 5행 미리보기" }).waitFor();
await shot("upload-mapping", page.getByRole("dialog"));
await page.getByRole("button", { name: /행 처리 시작/ }).click();
await page
  .getByRole("region", { name: "업로드 결과" })
  .waitFor({ timeout: 120_000 });
await shot("upload-result", page.getByRole("dialog"));

await browser.close();
