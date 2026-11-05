import { expect, test, type Page } from "@playwright/test";

const HOME = "http://127.0.0.1:3000/";

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

const contactTable = (page: Page) =>
  page.getByRole("table", { name: "연락처" });

test.describe("주소록", () => {
  test("지점은 연락처를 추가·수정·삭제하고 번호는 정규화된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "주소록" })
      .click();
    await expect(page.getByText("1–50 / 60명")).toBeVisible();

    await page.getByRole("button", { name: "연락처 추가" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("전화번호").fill("abc");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(
      dialog.getByText("전화번호 형식을 확인해 주세요"),
    ).toBeVisible();

    // 샘플과 겹치는 번호
    await dialog.getByLabel("전화번호").fill("010-0000-0001");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog.getByText("이미 주소록에 있는 번호예요")).toBeVisible();

    // 이름과 메모를 비워도 저장된다.
    await dialog.getByLabel("전화번호").fill("010-0000-9002");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      contactTable(page).getByRole("row", { name: /010-0000-9002/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "연락처 추가" }).click();
    await dialog.getByLabel("전화번호").fill("010 0000 9001");
    await dialog.getByLabel("이름").fill("새손님");
    await dialog.getByLabel("단골 손님").check();
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog).toBeHidden();

    const row = contactTable(page).getByRole("row", { name: /새손님/ });
    await expect(row).toContainText("010-0000-9001");
    await expect(row).toContainText("단골 손님");

    await row.getByRole("button", { name: "수정" }).click();
    await dialog.getByLabel("메모").fill("주말 배달");
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(row).toContainText("주말 배달");

    await row.getByRole("button", { name: "삭제" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("지난 발송 기록은 그대로 남아요");
    await confirm.getByRole("button", { name: "삭제" }).click();
    await expect(contactTable(page).getByText("새손님")).toHaveCount(0);
  });

  test("검색과 그룹 필터가 URL에 남고 새로고침해도 유지된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "망원점");
    await page.goto("/contacts");

    await page.getByRole("searchbox", { name: /검색/ }).fill("고객12");
    await expect(page).toHaveURL(/q=/);
    await expect(contactTable(page).getByRole("row")).toHaveCount(2);

    await page.reload();
    await expect(
      contactTable(page).getByRole("row", { name: /고객12/ }),
    ).toBeVisible();

    await page.getByRole("searchbox", { name: /검색/ }).fill("");
    await expect(page).not.toHaveURL(/q=/);

    await page
      .getByRole("combobox", { name: "그룹" })
      .selectOption({ label: "단골 손님 (30)" });
    await expect(page).toHaveURL(/group=/);
    await expect(page.getByText("1–30 / 30명")).toBeVisible();
  });

  test("페이지를 넘길 수 있고 잘못된 URL 값에도 화면이 깨지지 않는다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "합정점");
    await page.goto("/contacts");

    await page.getByRole("link", { name: "다음" }).click();
    await expect(page.getByText("51–60 / 60명")).toBeVisible();
    await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();

    await page.goto("/contacts?group=abc&branch=x&page=-1");
    await expect(page.getByText("1–50 / 60명")).toBeVisible();
  });

  test("그룹을 만들고 이름을 바꾸고 삭제해도 연락처는 남는다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");

    await page.getByRole("button", { name: "그룹 만들기" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("그룹 이름").fill("단골 손님");
    await dialog.getByRole("button", { name: "만들기" }).click();
    await expect(dialog.getByText("같은 이름의 그룹이 있어요")).toBeVisible();

    await dialog.getByLabel("그룹 이름").fill("행사 손님");
    await dialog.getByRole("button", { name: "만들기" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "행사 손님 이름 바꾸기" }).click();
    await dialog.getByLabel("그룹 이름").fill("봄 행사");
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(
      page.getByRole("button", { name: "봄 행사 삭제" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "단골 손님 삭제" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(
      page.getByRole("button", { name: "단골 손님 삭제" }),
    ).toHaveCount(0);
    await expect(page.getByText("1–50 / 60명")).toBeVisible();
  });

  test("본사는 전 지점을 조회만 한다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/contacts");

    await expect(page.getByText("1–50 / 180명")).toBeVisible();
    await expect(page.getByRole("button", { name: "연락처 추가" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "수정" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "그룹 만들기" })).toHaveCount(
      0,
    );

    await page
      .getByRole("combobox", { name: "지점" })
      .selectOption({ label: "성수점" });
    await expect(page.getByText("1–50 / 60명")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "그룹" })).toBeVisible();
  });

  test("수신거부 번호는 연락처에 표시된다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts?q=01000000007");

    await expect(
      contactTable(page).getByRole("row", { name: /고객7/ }),
    ).toContainText("수신거부");
  });
});

test.describe("수신거부", () => {
  test("지점은 등록만, 본사는 해제까지 한다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");
    await page
      .getByRole("navigation", { name: "주소록" })
      .getByRole("link", { name: "수신거부" })
      .click();
    await expect(page).toHaveURL(/opt-outs/);

    const table = page.getByRole("table", { name: "수신거부" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("button", { name: "해제" })).toHaveCount(0);

    await page.getByRole("button", { name: "수신거부 등록" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("전화번호").fill("010-0000-0007");
    await dialog.getByRole("button", { name: "등록" }).click();
    await expect(
      dialog.getByText("이미 수신거부에 등록된 번호예요"),
    ).toBeVisible();

    await dialog.getByLabel("전화번호").fill("010-0000-8888");
    await dialog.getByLabel("사유").fill("전화 요청");
    await dialog.getByRole("button", { name: "등록" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      table.getByRole("row", { name: /010-0000-8888/ }),
    ).toContainText("직접 등록");

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /본사 관리자/ }).click();
    const row = table.getByRole("row", { name: /010-0000-8888/ });
    await row.getByRole("button", { name: "해제" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("다시 문자가 나갈 수 있어요");
    await confirm.getByRole("button", { name: "해제" }).click();
    await expect(table.getByText("010-0000-8888")).toHaveCount(0);
    expect(page.url()).not.toBe(HOME);
  });
});

test("연락처 창에서 수신 동의를 켜고 끌 수 있다", async ({ page }) => {
  await startTrial(page);
  await switchToBranch(page, "성수점");
  await page.goto("/contacts?q=010-9999");
  const phone = `010-9999-${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;

  await page.getByRole("button", { name: "연락처 추가" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("전화번호").fill(phone);
  await dialog.getByRole("button", { name: "추가" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: phone });
  await expect(row.getByText("미동의")).toBeVisible();

  await row.getByRole("button", { name: /수정/ }).click();
  await page
    .getByRole("checkbox", { name: "광고 수신 동의를 받았어요" })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /저장|수정/ })
    .click();
  await expect(row.getByText("동의", { exact: true })).toBeVisible();
});
