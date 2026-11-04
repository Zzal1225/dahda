import { expect, test, type Page } from "@playwright/test";

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

    await pickGroup(page, /신규 손님/);
    const summary = page.getByRole("status").filter({ hasText: "총" });
    // 신규 손님 30명 중 샘플 수신거부 2명(7, 13번) 제외
    await expect(summary).toContainText("총 28명 · 수신거부 2명 제외");

    await body(page).fill("배송 안내입니다");
    await expect(page.getByText("28건 × 20원 =")).toBeVisible();
    await expect(page.getByText("발송 후 잔액 ₩1,999,440")).toBeVisible();

    await page.getByRole("button", { name: "보내기", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "보내기 확인" });
    await expect(dialog).toContainText("보낸 뒤에는 취소할 수 없어요");
    await dialog.getByRole("button", { name: "28건 보내기" }).click();

    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(page.getByRole("banner")).toContainText("₩1,999,440");
    const selected = page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { selected: true });
    await expect(selected).toContainText("배송 안내입니다");
    await expect(selected).toContainText("예약");
    await expect(page.getByText("1–28 / 28건")).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "수신자 상태" })
        .getByRole("button", { name: /대기/ }),
    ).toContainText("28");
  });

  test("지점 광고는 승인 대기가 되고 잔액이 줄지 않는다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "망원점");
    await page.goto("/compose");

    await pickGroup(page, /단골 손님/);
    await body(page).fill("주말 특가 행사");
    await page.getByRole("switch", { name: "광고 문자예요" }).check();
    await scheduleTomorrowMorning(page);
    await expect(
      page.getByText("잔액은 승인 후 실제로 발송될 때 차감돼요."),
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
      .filter({ hasText: "단골 손님" })
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
    await page.goto("/compose");

    await page.getByRole("radio", { name: "주소록에서 선택" }).click();
    await page
      .getByRole("searchbox", { name: "받는 사람 검색" })
      .fill("01000000007");
    await expect(page.getByRole("checkbox", { name: /고객7/ })).toBeDisabled();

    await page
      .getByRole("searchbox", { name: "받는 사람 검색" })
      .fill("01000000001");
    await page.getByRole("checkbox", { name: /고객1\b/ }).check();
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
    await pickGroup(page, /단골 손님/);
    await expect(send).toBeDisabled();
    await body(page).fill("내용");
    await expect(send).toBeEnabled();
  });
});
