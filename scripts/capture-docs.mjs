// README 캡처(docs/assets)를 다시 만든다. 체험 계정으로 들어가 화면을 연다.
// 실행: npm run dev 를 띄운 뒤 node scripts/capture-docs.mjs [주소, 기본 http://127.0.0.1:3000]
// 손으로 찍으면 다음 변경 때 같은 화면을 다시 만들 수 없어 스크립트로 둔다.
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
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
  .nth(11)
  .waitFor();
await shot("history-states", page.locator("main"));

// 2. 수신자 기록: 결과 웹훅이 접수 기록보다 먼저 온 행(샘플 3번)
await page
  .getByRole("table", { name: "발송 건" })
  .getByRole("row", { name: /성수점 \[주차장 공사/ })
  .click();
await page
  .getByRole("searchbox", { name: "수신번호 검색" })
  .fill("01000000003");
await page.waitForURL(/q=01000000003/);
await page.getByRole("button", { name: "010-0000-0003 기록 보기" }).click();
await page.getByRole("list", { name: "수신자 기록" }).waitFor();
await shot("message-events", page.getByRole("dialog"));
await page.keyboard.press("Escape");

// 3. 10만 행 샘플: 한 스크롤 가상화와 "그린 행"
await page.goto(`${BASE}/history/sample`);
await page.getByText(/그린 행/).waitFor();
await page.locator("[data-row]").first().waitFor();
await shot("sample-100k", page.locator("main"));

// 4. 엑셀 업로드 오류: 형식 오류·중복·수신거부를 나눠 보여 준다
await switchTo(/지점 · 성수점/);
await page.getByRole("banner").getByText("성수점").waitFor();
// 바로 주소로 열면 화면이 준비되기 전에 파일이 들어가 무시된다. 링크로 들어간다.
await page.goto(`${BASE}/contacts`);
await page.getByRole("link", { name: "엑셀 업로드" }).click();
await page.getByRole("button", { name: "파일 선택" }).waitFor();
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.aoa_to_sheet([
    ["전화번호", "이름", "메모", "수신 동의"],
    ["010-0000-7001", "새손님1", "주말", "Y"],
    [1000007002, "새손님2", null, "2026-10-01"],
    ["잘못된번호", "새손님3", null, "Y"],
    ["010-0000-7004", "새손님4", null, "모름"],
    ["010-0000-7001", "파일 안 중복", null, "N"],
    ["010-0000-0001", "이미 있는 번호", null, "Y"],
    ["010-0000-0007", "수신거부 번호", null, "Y"],
  ]),
  "시트",
);
await page.getByLabel("업로드할 파일").setInputFiles({
  name: "연락처.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
});
await page.getByRole("group", { name: "형식 오류", exact: true }).waitFor();
await shot("upload-errors", page.locator("main"));

await browser.close();
