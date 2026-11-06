import { expect, test, type Page } from "@playwright/test";

/**
 * 체험 주소록은 이름·번호가 매번 무작위다(지점마다 500명). 고정 값을 가정하지 않고 화면에서 읽어 쓴다:
 * 번호는 행을 눌러 상세(드로어)의 전체 번호를, 인원은 왼쪽 그룹 목록의 숫자를 읽는다.
 */
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

async function switchToHq(page: Page) {
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name: /본사 관리자/ }).click();
  await expect(page.getByRole("banner")).toContainText("전체 지점");
}

const contactTable = (page: Page) =>
  page.getByRole("table", { name: "연락처" });
const bodyRows = (page: Page) => contactTable(page).locator("[data-row]");
const groupNav = (page: Page) => page.getByRole("navigation", { name: "그룹" });
const groupItem = (page: Page, name: string) =>
  groupNav(page).getByRole("button", {
    name: new RegExp(`^${name} [0-9,]+명$`),
  });

/** 행을 눌러 상세를 열고 전체 번호(숫자만)를 읽는다. 닫고 돌려준다. */
async function fullPhoneOf(page: Page, row: ReturnType<Page["locator"]>) {
  await row.click();
  const drawer = page.getByRole("dialog");
  const text = await drawer
    .locator("dt", { hasText: "전화번호" })
    .locator("xpath=following-sibling::dd")
    .innerText();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  return text.trim();
}

async function countOf(page: Page, name: string): Promise<number> {
  const text = await groupItem(page, name).innerText();
  return Number(text.replace(/[^0-9]/g, ""));
}

test.describe("주소록", () => {
  test("표는 번호를 가리고, 행을 누르면 상세에서 전체 번호와 받은 문자를 본다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "주소록" })
      .click();
    await expect(page.getByText("1–50 / 500명")).toBeVisible();

    const first = bodyRows(page).first();
    await expect(first).toContainText(/010-\*{4}-\d{4}/);
    // 메모 열은 없다. 메모는 이름 옆 아이콘과 상세에서 본다.
    await expect(
      contactTable(page).getByRole("columnheader", { name: "메모" }),
    ).toHaveCount(0);

    await first.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(/010-\d{4}-\d{4}/);
    // 체험 발송 샘플의 수신자는 주소록 사람이라 대부분 받은 문자가 있다. 없으면 빈 상태 안내가 보인다.
    await expect(
      drawer
        .getByRole("region", { name: "최근 받은 문자" })
        .getByText(/도착|접수|실패|대기|아직 받은 문자가 없어요/)
        .first(),
    ).toBeVisible();
    await expect(drawer.getByRole("button", { name: "수정" })).toBeVisible();
  });

  test("지점은 연락처를 추가·수정·삭제하고 번호는 정규화된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");
    const existing = await fullPhoneOf(page, bodyRows(page).first());

    await page.getByRole("button", { name: "연락처 추가" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("전화번호").fill("abc");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(
      dialog.getByText("전화번호 형식을 확인해 주세요"),
    ).toBeVisible();

    await dialog.getByLabel("전화번호").fill(existing);
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog.getByText("이미 주소록에 있는 번호예요")).toBeVisible();

    await dialog.getByLabel("전화번호").fill("010 0000 9001");
    await dialog.getByLabel("이름").fill("새손님");
    await dialog.getByLabel("단골").check();
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog).toBeHidden();

    // 방금 넣은 사람이 맨 위(최근 등록순)다.
    const row = bodyRows(page).first();
    await expect(row).toContainText("새손님");
    await expect(row).toContainText("010-****-9001");
    await expect(row).toContainText("단골");

    await row.click();
    const drawer = page.getByRole("dialog", { name: "새손님" });
    await expect(drawer).toContainText("010-0000-9001");
    await drawer.getByRole("button", { name: "수정" }).click();
    const edit = page.getByRole("dialog", { name: "연락처 고치기" });
    await edit.getByLabel("메모").fill("주말 배달");
    await edit.getByRole("button", { name: "저장" }).click();
    await expect(edit).toBeHidden();
    await expect(drawer).toContainText("주말 배달");

    await drawer.getByRole("button", { name: "삭제" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("지난 발송 기록은 그대로 남아요");
    await confirm.getByRole("button", { name: "삭제" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(contactTable(page).getByText("새손님")).toHaveCount(0);
  });

  test("뒤 4자리 검색·그룹·수신 상태가 URL에 남고 새로고침해도 유지된다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "망원점");
    await page.goto("/contacts");

    const phone = await fullPhoneOf(page, bodyRows(page).nth(3));
    const last4 = phone.slice(-4);
    await page.getByRole("searchbox", { name: /검색/ }).fill(last4);
    await expect(page).toHaveURL(new RegExp(`q=${last4}`));
    await expect(bodyRows(page).first()).toContainText(`-${last4}`);
    await page.reload();
    await expect(bodyRows(page).first()).toContainText(`-${last4}`);
    await page.getByRole("searchbox", { name: /검색/ }).fill("");
    await expect(page).not.toHaveURL(/q=/);

    const regulars = await countOf(page, "단골");
    await groupItem(page, "단골").click();
    await expect(page).toHaveURL(/group=/);
    await expect(groupItem(page, "단골")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      page.getByText(new RegExp(`/ ${regulars.toLocaleString("ko-KR")}명`)),
    ).toBeVisible();

    await groupItem(page, "전체").click();
    await page.getByRole("button", { name: /수신 상태:/ }).click();
    await page.getByRole("menuitemradio", { name: "수신거부" }).click();
    await expect(page).toHaveURL(/status=opted_out/);
    const statuses = bodyRows(page).getByText(/^(동의|미동의|수신거부)$/);
    await expect(statuses.first()).toHaveText("수신거부");
    expect(new Set(await statuses.allInnerTexts())).toEqual(
      new Set(["수신거부"]),
    );
  });

  test("페이지를 넘길 수 있고 잘못된 URL 값에도 화면이 깨지지 않는다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "합정점");
    await page.goto("/contacts");

    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("51–100 / 500명")).toBeVisible();
    await expect(page).toHaveURL(/page=2/);

    await page.goto("/contacts?group=abc&branch=x&status=zz&page=-1");
    await expect(page.getByText("1–50 / 500명")).toBeVisible();
  });

  test("그룹을 만들고 이름을 바꾸고 삭제해도 연락처는 남는다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");

    await groupNav(page).getByRole("button", { name: "새 그룹" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("그룹 이름").fill("단골");
    await dialog.getByRole("button", { name: "만들기" }).click();
    await expect(dialog.getByText("같은 이름의 그룹이 있어요")).toBeVisible();

    await dialog.getByLabel("그룹 이름").fill("행사 손님");
    await dialog.getByRole("button", { name: "만들기" }).click();
    await expect(dialog).toBeHidden();
    await expect(groupItem(page, "행사 손님")).toContainText("0");

    await groupNav(page)
      .getByRole("button", { name: "행사 손님 이름 바꾸기" })
      .click();
    await dialog.getByLabel("그룹 이름").fill("봄 행사");
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(groupItem(page, "봄 행사")).toBeVisible();

    await groupNav(page).getByRole("button", { name: "단골 삭제" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(
      groupNav(page).getByRole("button", { name: "단골 삭제" }),
    ).toHaveCount(0);
    await expect(page.getByText("1–50 / 500명")).toBeVisible();
  });

  test("본사는 전 지점을 보고, 지점을 고르면 그 지점 그룹만 보인다", async ({
    page,
  }) => {
    await startTrial(page);
    await page.goto("/contacts");

    await expect(page.getByText("1–50 / 1,500명")).toBeVisible();
    await expect(page.getByRole("button", { name: "연락처 추가" })).toHaveCount(
      0,
    );
    await expect(
      groupNav(page).getByRole("button", { name: "새 그룹" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "내보내기" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "엑셀 업로드" }),
    ).toBeVisible();
    await expect(
      contactTable(page).getByRole("columnheader", { name: "지점" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^지점:/ }).click();
    await page.getByRole("menuitemradio", { name: "성수점" }).click();
    await expect(page).toHaveURL(/branch=/);
    await expect(page.getByText("1–50 / 500명")).toBeVisible();
    // 지점 이름 꼬리표가 붙은 다른 지점 그룹은 사라진다.
    await expect(groupNav(page).getByText("망원점")).toHaveCount(0);
  });

  test("고른 연락처를 그룹에 넣고 문자 작성으로 넘긴다", async ({ page }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");

    await bodyRows(page).nth(0).getByRole("checkbox").check();
    await bodyRows(page).nth(1).getByRole("checkbox").check();
    const bar = page.getByRole("region", { name: "선택한 연락처" });
    await expect(bar).toContainText("2명 선택");

    await bar.getByRole("button", { name: "그룹에 추가" }).click();
    await page.getByRole("menuitem", { name: "신규" }).click();
    await expect(bar.getByRole("status")).toContainText(/"신규"에 넣었어요/);

    await bar.getByRole("link", { name: "문자 작성" }).click();
    await expect(page).toHaveURL(/\/compose\?contacts=/);
    await expect(page.getByText("고른 연락처")).toBeVisible();
    await expect(page.getByText("2명", { exact: true })).toBeVisible();
  });
});

test.describe("수신거부", () => {
  test("그룹 목록의 수신거부에서 지점은 등록만, 본사는 해제까지 한다", async ({
    page,
  }) => {
    await startTrial(page);
    await switchToBranch(page, "성수점");
    await page.goto("/contacts");

    // 이미 수신거부인 번호를 상태 필터로 찾아 전체 번호를 읽는다.
    await page.goto("/contacts?status=opted_out");
    const optedOut = await fullPhoneOf(page, bodyRows(page).first());

    await page.goto("/contacts");
    const total = await countOf(page, "수신거부");
    await groupItem(page, "수신거부").click();
    await expect(page).toHaveURL(/group=opt-outs/);
    const table = page.getByRole("table", { name: "수신거부" });
    await expect(table.locator("[data-row]")).toHaveCount(Math.min(total, 50));
    await expect(table.getByRole("button", { name: "해제" })).toHaveCount(0);

    await page.getByRole("button", { name: "수신거부 등록" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("전화번호").fill(optedOut);
    await dialog.getByRole("button", { name: "등록" }).click();
    await expect(
      dialog.getByText("이미 수신거부에 등록된 번호예요"),
    ).toBeVisible();

    await dialog.getByLabel("전화번호").fill("010-0000-8888");
    await dialog.getByLabel("사유").fill("전화 요청");
    await dialog.getByRole("button", { name: "등록" }).click();
    await expect(dialog).toBeHidden();
    const row = table.getByRole("row", { name: /010-\*{4}-8888/ });
    await expect(row).toContainText("직접 등록");

    await switchToHq(page);
    await row.getByRole("button", { name: "해제" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("다시 문자가 나갈 수 있어요");
    await confirm.getByRole("button", { name: "해제" }).click();
    await expect(table.getByText("010-****-8888")).toHaveCount(0);
  });

  test("예전 수신거부 주소는 새 목록으로 이어진다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/contacts/opt-outs");
    await expect(page).toHaveURL(/\/contacts\?group=opt-outs/);
    await expect(page.getByRole("table", { name: "수신거부" })).toBeVisible();
  });
});

test("상세에서 수신 동의를 켜고 끌 수 있다", async ({ page }) => {
  await startTrial(page);
  await switchToBranch(page, "성수점");
  await page.goto("/contacts");
  const suffix = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

  await page.getByRole("button", { name: "연락처 추가" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("전화번호").fill(`010-0000-${suffix}`);
  await dialog.getByLabel("이름").fill("동의확인");
  await dialog.getByRole("button", { name: "추가" }).click();
  await expect(dialog).toHaveCount(0);
  const row = bodyRows(page).filter({ hasText: "동의확인" });
  await expect(row.getByText("미동의")).toBeVisible();

  await row.click();
  await page.getByRole("dialog").getByRole("button", { name: "수정" }).click();
  await page
    .getByRole("checkbox", { name: "광고 수신 동의를 받았어요" })
    .check();
  await page
    .getByRole("dialog", { name: "연락처 고치기" })
    .getByRole("button", { name: "저장" })
    .click();
  // 상세가 열려 있는 동안 뒤의 표는 접근성 트리에서 가려진다(모달). 상세에서 먼저 보고, 닫은 뒤 표에서 본다.
  const drawer = page.getByRole("dialog", { name: "동의확인" });
  await expect(drawer.getByText("동의", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row.getByText("동의", { exact: true })).toBeVisible();
});
