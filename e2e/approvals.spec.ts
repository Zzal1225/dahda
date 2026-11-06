import { expect, test, type Page } from "@playwright/test";

async function startTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
}

async function switchTo(page: Page, name: RegExp | string) {
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name }).click();
}

/** 지점 역할로 다음 날 10시 광고를 승인 요청한다. 시각을 고정해 야간 제한과 무관하게 한다. */
async function requestAd(page: Page, branch: string, text: string) {
  await switchTo(page, `지점 · ${branch}`);
  await expect(page.getByRole("banner")).toContainText(branch);
  await page.goto("/compose");
  await page.getByRole("checkbox", { name: /단골 손님/ }).check();
  await page.getByRole("textbox", { name: "보낼 내용" }).fill(text);
  await page.getByRole("switch", { name: "광고 문자예요" }).check();
  await page.getByRole("radio", { name: "예약 발송" }).check();
  await page
    .getByRole("combobox", { name: "예약 날짜" })
    .selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "예약 시각" }).selectOption("10:00");
  await expect(
    page.getByRole("status").filter({ hasText: "총" }),
  ).toContainText("명");
  await page.getByRole("button", { name: "승인 요청" }).click();
  await page
    .getByRole("dialog", { name: "승인 요청 확인" })
    .getByRole("button", { name: "승인 요청" })
    .click();
  await expect(page).toHaveURL(/\/history\?campaign=/);
}

test.describe("승인함", () => {
  test("본사가 승인하면 지점 잔액이 차감되고 취소할 수 없다", async ({
    page,
  }) => {
    await startTrial(page);
    await requestAd(page, "성수점", "주말 특가 안내");
    await expect(page.getByRole("banner")).toContainText("₩2,000,000");

    await switchTo(page, /본사 관리자/);
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav.getByRole("link", { name: /승인함/ })).toContainText("2");
    await nav.getByRole("link", { name: /승인함/ }).click();

    // 체험 샘플의 성수점 광고 1건이 이미 기다리고 있다.
    await expect(
      page.getByRole("heading", { name: /승인 대기 2건/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: /주말 특가 안내/ }).click();

    await expect(
      page.getByRole("heading", { name: "성수점 광고 문자" }),
    ).toBeVisible();
    await expect(page.getByTestId("approval-body")).toContainText(
      "(광고)dahda마트 성수점",
    );
    await expect(page.getByTestId("approval-body")).toContainText("무료거부");
    await expect(page.getByText("성수점 · 현재 ₩2,000,000")).toBeVisible();

    await page.getByRole("button", { name: "승인", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("승인 후에는 취소할 수 없어요");
    await dialog.getByRole("button", { name: "승인하기" }).click();

    await expect(page).toHaveURL(/\/approvals\?done=approved/);
    await expect(page.getByRole("status")).toContainText("승인했어요");
    await expect(
      page.getByRole("heading", { name: /승인 대기 1건/ }),
    ).toBeVisible();

    // 지점은 승인함에 머물 수 없어 첫 화면으로 돌아간다. 첫 화면은 잔액 칸에 잔액을 보인다.
    await switchTo(page, "지점 · 성수점");
    await expect(
      page.getByRole("region", { name: "잔액", exact: true }),
    ).toContainText("₩1,999,520");
    await page.goto("/history");
    await page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { name: /주말 특가 안내/ })
      .click();
    await expect(page.getByRole("button", { name: "예약 취소" })).toHaveCount(
      0,
    );
  });

  test("반려하려면 사유가 필요하고, 지점은 사유를 본다", async ({ page }) => {
    await startTrial(page);
    await requestAd(page, "망원점", "봄 행사 안내");

    await switchTo(page, /본사 관리자/);
    await page.goto("/approvals");
    await page.getByRole("link", { name: /봄 행사 안내/ }).click();

    await page.getByRole("button", { name: "반려", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "반려하기" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "반려 사유를 입력해 주세요",
    );

    await dialog.getByRole("button", { name: "문구 수정이 필요해요" }).click();
    await expect(dialog.getByLabel("반려 사유")).toHaveValue(
      "문구 수정이 필요해요",
    );
    await dialog.getByRole("button", { name: "반려하기" }).click();
    await expect(page).toHaveURL(/done=rejected/);

    await switchTo(page, "지점 · 망원점");
    await expect(
      page.getByRole("region", { name: "잔액", exact: true }),
    ).toContainText("₩1,310,400");
    await page.goto("/history");
    await page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { name: /봄 행사 안내/ })
      .click();
    await expect(page.getByText("문구 수정이 필요해요")).toBeVisible();
  });

  test("지점은 승인함에 들어갈 수 없고 메뉴도 없다", async ({ page }) => {
    await startTrial(page);
    await switchTo(page, "지점 · 합정점");
    await expect(page.getByRole("banner")).toContainText("합정점");

    await expect(
      page
        .getByRole("navigation", { name: "주 메뉴" })
        .getByRole("link", { name: /승인함/ }),
    ).toHaveCount(0);
    await page.goto("/approvals");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
  });

  test("잘못된 주소나 처리된 요청은 목록으로 돌아간다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/approvals/abc");
    await expect(page).toHaveURL(/\/approvals$/);
    await page.goto("/approvals/5eed0000-0000-4000-8000-000000000099");
    await expect(page).toHaveURL(/\/approvals$/);
  });

  test("모바일에서 승인함은 쓸 수 있고 다른 화면은 안내가 나온다", async ({
    page,
  }) => {
    await startTrial(page);
    await requestAd(page, "합정점", "모바일 승인 시험");
    await switchTo(page, /본사 관리자/);
    await expect(page.getByRole("banner")).toContainText("전체 지점");

    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/history");
    await expect(page.getByText("PC에서 열어 주세요")).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByText("PC에서 열어 주세요")).toBeHidden();
    await expect(
      page.getByRole("heading", { name: /승인 대기 2건/ }),
    ).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
    expect(await overflow()).toBe(0);

    await page.getByRole("link", { name: /모바일 승인 시험/ }).click();
    await expect(
      page.getByRole("heading", { name: "합정점 광고 문자" }),
    ).toBeVisible();
    expect(await overflow()).toBe(0);

    const approve = page.getByRole("button", { name: "승인", exact: true });
    await expect(approve).toBeInViewport();
    expect((await approve.boundingBox())?.height).toBe(48);

    const preview = page.getByRole("complementary", {
      name: "휴대폰 미리보기",
    });
    await expect(preview.getByTestId("approval-preview")).toContainText(
      "모바일 승인 시험",
    );

    await approve.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "승인하기" })
      .click();
    await expect(page).toHaveURL(/done=approved/);
  });
});

test.describe("예약 취소", () => {
  test("예약을 취소하면 잔액이 돌아오고 메시지가 사라진다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchTo(page, "지점 · 성수점");
    await expect(page.getByRole("banner")).toContainText("성수점");
    await page.goto("/compose");

    await page.getByRole("checkbox", { name: /단골 손님/ }).check();
    await page.getByRole("textbox", { name: "보낼 내용" }).fill("취소할 예약");
    await page.getByRole("radio", { name: "예약 발송" }).check();
    await page
      .getByRole("combobox", { name: "예약 날짜" })
      .selectOption({ index: 1 });
    await page
      .getByRole("combobox", { name: "예약 시각" })
      .selectOption("10:00");
    await expect(
      page.getByRole("status").filter({ hasText: "총" }),
    ).toContainText("명");
    await page.getByRole("button", { name: "예약하기" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /건 예약/ })
      .click();
    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(page.getByRole("banner")).not.toContainText("₩2,000,000");

    await page.getByRole("button", { name: "예약 취소" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "예약 취소" }).click();

    await expect(page.getByRole("banner")).toContainText("₩2,000,000");
    const row = page
      .getByRole("table", { name: "발송 건" })
      .getByRole("row", { selected: true });
    await expect(row).toContainText("취소");
    await expect(page.getByRole("button", { name: "예약 취소" })).toHaveCount(
      0,
    );
  });

  test("지금 보낸 건에는 취소 버튼이 없다", async ({ page }) => {
    await startTrial(page);
    await switchTo(page, "지점 · 망원점");
    await expect(page.getByRole("banner")).toContainText("망원점");
    await page.goto("/compose");

    await page.getByRole("checkbox", { name: /신규 손님/ }).check();
    await page.getByRole("textbox", { name: "보낼 내용" }).fill("지금 보내기");
    await expect(
      page.getByRole("status").filter({ hasText: "총" }),
    ).toContainText("명");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /건 보내기/ })
      .click();
    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(
      page
        .getByRole("table", { name: "수신자별 결과" })
        .locator("[data-row]")
        .first(),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "예약 취소" })).toHaveCount(
      0,
    );
  });
});
