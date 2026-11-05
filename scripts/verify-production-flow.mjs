/**
 * 1차 완료 조건 확인: 체험 → 엑셀 업로드 → 광고 작성 → 본사 승인 → 발송 → 결과 반영.
 * 사용: node scripts/verify-production-flow.mjs [기준 주소] [캡처 폴더]
 *
 * 체험 계정은 일반 발송이 가짜 발송기로 고정이라 실제 문자는 나가지 않는다. 번호도 실제로 쓰지 않는 010-0000 형식이다.
 * 야간 광고 제한에 걸리면 밤 동안 미뤄져 끝나지 않으므로, 제한 시간대 밖에서 돌린다.
 * 새로고침 없이 화면이 바뀌는지가 조건이라 결과를 기다리는 동안 다시 불러오지 않는다.
 */
import { chromium, expect } from "@playwright/test";
import * as XLSX from "xlsx";

const BASE = process.argv[2] ?? "https://dahda-xi.vercel.app";
const SHOTS = process.argv[3];
const BRANCH = "성수점";
const TEXT = `주말 특가 안내 ${Date.now() % 100_000}`;
const RESULT_LIMIT_MS = 120_000;

const started = performance.now();
const step = (name) =>
  console.log(`${((performance.now() - started) / 1000).toFixed(1)}초 ${name}`);

const browser = await chromium.launch();
const page = await (
  await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    baseURL: BASE,
  })
).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const switchTo = async (name) => {
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name }).click();
};

try {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible({ timeout: 30_000 });
  step("체험 시작");

  await switchTo(`지점 · ${BRANCH}`);
  await expect(page.getByRole("banner")).toContainText(BRANCH);
  const before = await page.getByRole("banner").innerText();

  await page.goto("/contacts/upload");
  // 화면이 준비되기 전에 파일을 넣으면 이벤트를 놓친다. 사람은 이 속도로 고를 수 없으므로 준비를 기다린다.
  await page.waitForLoadState("networkidle");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["전화번호", "이름", "메모"],
      ["010-0000-7101", "시험손님1", "운영 시험"],
      ["010-0000-7102", "시험손님2", "운영 시험"],
      ["010-0000-7103", "시험손님3", "운영 시험"],
    ]),
    "시트",
  );
  await page.getByLabel("업로드할 파일").setInputFiles({
    name: "연락처.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
  });
  await expect(
    page.getByRole("group", { name: "저장할 수 있어요", exact: true }),
  ).toContainText("3", { timeout: 20_000 });
  await page
    .getByRole("combobox", { name: "저장할 그룹" })
    .selectOption({ label: "단골 손님" });
  await page.getByRole("button", { name: "3명 저장" }).click();
  await expect(page.getByText("3명을 저장했어요")).toBeVisible();
  step("엑셀 업로드 3명 저장");
  await shot("1-upload");

  await page.goto("/compose");
  await page.getByRole("checkbox", { name: /단골 손님/ }).check();
  await page.getByRole("textbox", { name: "보낼 내용" }).fill(TEXT);
  await page.getByRole("switch", { name: "광고 문자예요" }).check();
  await expect(
    page.getByRole("status").filter({ hasText: "총" }),
  ).toContainText("명");
  await shot("2-compose");
  await page.getByRole("button", { name: "승인 요청" }).click();
  await page
    .getByRole("dialog", { name: "승인 요청 확인" })
    .getByRole("button", { name: "승인 요청" })
    .click();
  await expect(page).toHaveURL(/\/history\?campaign=/, { timeout: 30_000 });
  step("광고 작성, 승인 요청");

  await switchTo(/본사 관리자/);
  await expect(page.getByRole("banner")).toContainText("본사");
  await page.goto("/approvals");
  await page.getByRole("link", { name: new RegExp(TEXT) }).click();
  await expect(page.getByTestId("approval-body")).toContainText("(광고)");
  await expect(page.getByTestId("approval-body")).toContainText("무료거부");
  await shot("3-approval");
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "승인하기" })
    .click();
  await expect(page).toHaveURL(/\/approvals\?done=approved/, {
    timeout: 30_000,
  });
  const approvedAt = performance.now();
  step("본사 승인");

  await switchTo(`지점 · ${BRANCH}`);
  await expect(page.getByRole("banner")).toContainText(BRANCH);
  await page.goto("/history");
  const row = page
    .getByRole("table", { name: "발송 건" })
    .getByRole("row")
    .filter({ hasText: TEXT });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot("4-sending");
  step(`발송 내역에 표시: ${(await row.innerText()).replace(/\s+/g, " ")}`);

  await expect(row).toContainText(/완료|일부 실패|발송 실패/, {
    timeout: RESULT_LIMIT_MS,
  });
  step(
    `결과 반영 (새로고침 없음, 승인 후 ${((performance.now() - approvedAt) / 1000).toFixed(1)}초): ${(await row.innerText()).replace(/\s+/g, " ")}`,
  );
  await row.click();
  await shot("5-result");

  await page.goto("/billing");
  const ledger = await page
    .getByRole("table", { name: "거래 내역" })
    .innerText();
  step(`거래 내역 위쪽: ${ledger.replace(/\s+/g, " ").slice(0, 160)}`);
  console.log("잔액 전:", before.match(/₩[\d,]+/)?.[0]);
  console.log(
    "잔액 후:",
    (await page.getByRole("banner").innerText()).match(/₩[\d,]+/)?.[0],
  );
  console.log("브라우저 오류:", errors.length ? errors : "없음");
  console.log("성공");
} finally {
  await browser.close();
}
