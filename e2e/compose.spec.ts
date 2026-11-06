import { expect, test, type Locator, type Page } from "@playwright/test";

async function startTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
}

async function switchToBranch(page: Page, name: string) {
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name: `지점 · ${name}` }).click();
  await expect(page.getByRole("banner")).toContainText(name);
}

const body = (page: Page) => page.getByRole("textbox", { name: "보낼 내용" });
const counter = (page: Page) => page.getByTestId("byte-counter");
const preview = (page: Page) => page.getByTestId("preview-body");

async function pickGroup(page: Page, name: RegExp | string) {
  await page.getByRole("checkbox", { name }).check();
}

/** 그룹 고르기 목록의 "N명". 체험 주소록은 매번 무작위라 화면에서 읽는다. */
async function groupSize(page: Page, name: string): Promise<number> {
  const text = await page
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: new RegExp(name) }) })
    .innerText();
  return Number(/([0-9,]+)명/.exec(text)?.[1]?.replace(/,/g, "") ?? NaN);
}

/** 수신 상태로 거른 주소록 첫 사람의 전체 번호(상세에서 읽는다). */
async function contactPhone(
  page: Page,
  status: "opted_out" | "consented",
): Promise<string> {
  await page.goto(`/contacts?status=${status}`);
  await page
    .getByRole("table", { name: "연락처" })
    .locator("[data-row]")
    .first()
    .click();
  const text = await page
    .getByRole("dialog")
    .locator("dt", { hasText: "전화번호" })
    .locator("xpath=following-sibling::dd")
    .innerText();
  await page.keyboard.press("Escape");
  return text.trim();
}

const numberAfter = (text: string, label: string) =>
  Number(
    new RegExp(`${label} ([0-9,]+)명`).exec(text)?.[1]?.replace(/,/g, "") ?? 0,
  );

/** "총 N명 · 수신거부 M명 제외 · 미동의 K명 제외". 0인 항목은 문구에 없다. */
async function readSummary(summary: Locator) {
  const text = await summary.innerText();
  return {
    total: numberAfter(text, "총"),
    optedOut: numberAfter(text, "수신거부"),
    noConsent: numberAfter(text, "미동의"),
  };
}

// 내일 10시. 광고의 야간 제한에 걸리지 않게 시각을 고정한다.
async function scheduleTomorrowMorning(page: Page) {
  await page.getByRole("radio", { name: "예약 발송" }).check();
  const day = page.getByRole("combobox", { name: "예약 날짜" });
  await day.selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "예약 시각" }).selectOption("10:00");
}

test.describe("문자 작성", () => {
  test("바이트를 세고 90byte를 넘으면 LMS로 바뀐다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "문자 작성" })
      .click();

    await body(page).fill("가나다a");
    await expect(counter(page)).toContainText("7 / 90 byte · SMS");
    await expect(preview(page)).toHaveText("가나다a");

    await body(page).fill("a".repeat(90));
    await expect(counter(page)).toContainText("90 / 90 byte · SMS");

    await body(page).fill("a".repeat(91));
    await expect(counter(page)).toContainText("91 / 2,000 byte · LMS");
    await expect(
      page.getByText(/90byte를 넘어서 LMS로 바뀌었어요/),
    ).toBeVisible();

    await body(page).fill("a".repeat(2001));
    await expect(page.getByText("2,000byte를 넘을 수 없어요")).toBeVisible();
  });

  test("광고는 앞뒤 고정 문구가 들어가고 바이트에 포함된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/compose");

    await body(page).fill("특가");
    await page.getByRole("switch", { name: "광고 문자예요" }).check();

    const text =
      "(광고)dahda마트 성수점 010-0000-0002\n특가\n무료거부 080-000-0000";
    await expect(preview(page)).toHaveText(text);
    await expect(page.getByText(/자동 문구 \d+byte 포함/)).toBeVisible();
    await expect(page.getByText("본사 승인 후 발송돼요.")).toBeVisible();

    // 광고는 야간 시각을 고를 수 없다.
    await page.getByRole("radio", { name: "예약 발송" }).check();
    const time = page.getByRole("combobox", { name: "예약 시각" });
    await expect(
      time.getByRole("option", { name: "22:00 야간" }),
    ).toBeDisabled();
    await expect(
      time.getByRole("option", { name: "10:00", exact: true }),
    ).toBeEnabled();
  });

  test("지점의 일반 문자는 잔액을 선점하고 수신거부를 뺀 뒤 접수된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    // 발송 내역을 먼저 봐서 목록이 캐시된 상태로 시작한다. 새 건이 바로 보여야 한다.
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await nav.getByRole("link", { name: "발송 내역" }).click();
    await expect(page.getByRole("table", { name: "발송 건" })).toBeVisible();
    await nav.getByRole("link", { name: "문자 작성" }).click();

    // 체험 주소록은 매번 무작위라 숫자를 고정하지 않는다. 그룹 인원 = 보낼 수 + 수신거부 제외 수인지 본다.
    const members = await groupSize(page, "신규");
    await pickGroup(page, /신규/);
    const summary = page.getByRole("status").filter({ hasText: "총" });
    await expect(summary).toContainText("총");
    const { total, optedOut } = await readSummary(summary);
    expect(total + optedOut).toBe(members);
    expect(optedOut).toBeGreaterThanOrEqual(0);

    const won = (value: number) => value.toLocaleString("ko-KR");
    const after = `₩${won(2_000_000 - total * 20)}`;
    await body(page).fill("배송 안내입니다");
    await expect(page.getByText(`${won(total)}건 × 20원 =`)).toBeVisible();
    await expect(page.getByText(`발송 후 잔액 ${after}`)).toBeVisible();

    await page.getByRole("button", { name: "보내기", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "보내기 확인" });
    await expect(dialog).toContainText("보낸 뒤에는 취소할 수 없어요");
    await dialog
      .getByRole("button", { name: `${won(total)}건 보내기` })
      .click();

    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(page.getByRole("banner")).toContainText(after);
    const selected = page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { selected: true });
    await expect(selected).toContainText("배송 안내입니다");
    await expect(selected).toContainText("예약");
    await expect(
      page.getByText(`1–${won(Math.min(total, 100))} / ${won(total)}건`),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "수신자 상태" })
        .getByRole("button", { name: /대기/ }),
    ).toContainText(won(total));
  });

  test("지점 광고는 승인 대기가 되고 잔액이 줄지 않는다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "망원점");
    await page.goto("/compose");

    await pickGroup(page, /단골/);
    await body(page).fill("주말 특가 행사");
    await page.getByRole("switch", { name: "광고 문자예요" }).check();
    await scheduleTomorrowMorning(page);
    await expect(
      page.getByText("잔액은 본사가 승인할 때 차감돼요."),
    ).toBeVisible();

    await page.getByRole("button", { name: "승인 요청" }).click();
    const dialog = page.getByRole("dialog", { name: "승인 요청 확인" });
    await dialog.getByRole("button", { name: "승인 요청" }).click();

    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(page.getByRole("banner")).toContainText("₩1,310,400");
    const selected = page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { selected: true });
    await expect(selected).toContainText("승인 대기");
    await expect(selected).toContainText("주말 특가 행사");
  });

  test("본사 광고는 승인 없이 예약되고 본사 잔액에서 차감된다", async ({
    page,
  }) => {
    await startTrial(page);
    await page.goto("/compose");

    await expect(page.getByText("성수점").first()).toBeVisible();
    await page
      .getByRole("listitem")
      .filter({ hasText: "성수점" })
      .filter({ hasText: "단골" })
      .getByRole("checkbox")
      .check();
    await body(page).fill("본사 행사 안내");
    await page.getByRole("switch", { name: "광고 문자예요" }).check();
    await expect(page.getByText("본사 승인 후 발송돼요.")).toHaveCount(0);
    await scheduleTomorrowMorning(page);

    await page.getByRole("button", { name: "예약하기" }).click();
    const dialog = page.getByRole("dialog", { name: "보내기 확인" });
    await dialog.getByRole("button", { name: /건 예약/ }).click();

    await expect(page).toHaveURL(/\/history\?campaign=/);
    const selected = page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { selected: true });
    await expect(selected).toContainText("본사 행사 안내");
    await expect(selected).toContainText("예약");
  });

  test("주소록에서 고를 수 있고 수신거부 번호는 고를 수 없다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "합정점");
    // 수신거부인 사람과 동의한 사람의 전체 번호를 주소록 상세에서 읽는다(체험 번호는 무작위).
    const optedOut = await contactPhone(page, "opted_out");
    const consented = await contactPhone(page, "consented");
    await page.goto("/compose");

    await page.getByRole("radio", { name: "주소록에서 선택" }).click();
    const search = page.getByRole("searchbox", { name: "받는 사람 검색" });
    await search.fill(optedOut.replace(/-/g, ""));
    await expect(
      page.getByRole("checkbox", { name: new RegExp(optedOut) }),
    ).toBeDisabled();

    await search.fill(consented.replace(/-/g, ""));
    await page.getByRole("checkbox", { name: new RegExp(consented) }).check();
    await expect(
      page.getByRole("status").filter({ hasText: "총" }),
    ).toContainText("총 1명");
  });

  test("받는 사람과 내용이 없으면 보낼 수 없다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/compose");

    const send = page.getByRole("button", { name: "보내기", exact: true });
    await expect(send).toBeDisabled();
    await pickGroup(page, /단골/);
    await expect(send).toBeDisabled();
    await body(page).fill("내용");
    await expect(send).toBeEnabled();
  });
});

test.describe("광고 수신 동의", () => {
  test("광고를 켜면 미동의 번호를 빼고 숫자를 다시 센다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(page.getByRole("note")).toBeVisible();
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: "지점 · 성수점" }).click();
    await expect(page.getByRole("banner")).toContainText("성수점");
    await page.goto("/compose");
    await page.getByRole("checkbox", { name: /단골/ }).check();

    const summary = page.getByRole("status").filter({ hasText: "총" });
    await expect(summary).toContainText("총");
    await expect(summary).not.toContainText("미동의");
    const plain = await readSummary(summary);

    await page.getByRole("switch", { name: "광고 문자예요" }).check();
    // 광고는 미동의를 뺀다: 보낼 수 + 미동의 제외 = 일반 문자일 때 보낼 수.
    await expect(summary)
      .not.toContainText(
        `총 ${plain.total.toLocaleString("ko-KR")}명`,
        // 미동의가 0명인 무작위 샘플이면 숫자가 그대로다. 그 경우만 넘어간다.
        { timeout: 3_000 },
      )
      .catch(() => undefined);
    const ad = await readSummary(summary);
    expect(ad.total + ad.noConsent).toBe(plain.total);

    await page.getByRole("switch", { name: "광고 문자예요" }).uncheck();
    await expect(summary).toContainText(
      `총 ${plain.total.toLocaleString("ko-KR")}명`,
    );
  });

  test("주소록의 수신 열에 동의 여부가 보인다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(page.getByRole("note")).toBeVisible();
    // 샘플은 무작위라 첫 페이지에 미동의가 없을 수 있다. 수신 상태로 걸러서 본다.
    await page.goto("/contacts?status=consented");
    const table = page.getByRole("table", { name: "연락처" });
    await expect(
      table.getByText("동의", { exact: true }).first(),
    ).toBeVisible();
    await page.goto("/contacts?status=not_consented");
    await expect(table.getByText("미동의").first()).toBeVisible();
  });
});
