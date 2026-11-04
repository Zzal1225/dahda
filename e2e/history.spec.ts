import { expect, test, type Page } from "@playwright/test";

async function openHistoryAsTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "발송 내역" })
    .click();
  await expect(page.getByRole("heading", { name: "발송 내역" })).toBeVisible();
}

const campaignTable = (page: Page) =>
  page.getByRole("table", { name: "발송 건" });
const recipientTable = (page: Page) =>
  page.getByRole("table", { name: "수신자별 결과" });

test.describe("발송 내역", () => {
  test("발송 건을 고르면 수신자별 결과가 열리고 새로고침해도 유지된다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);

    // 계정 4개 × 2건. 본사는 전 지점을 본다.
    await expect(campaignTable(page).getByRole("row")).toHaveCount(9);

    await campaignTable(page)
      .getByRole("row", { name: /성수점 이번 주 특가/ })
      .click();

    await expect(page).toHaveURL(/campaign=/);
    const rows = recipientTable(page).locator("[data-row]");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();
    await expect(
      page.getByText("결과 확정 · 더 이상 바뀌지 않아요"),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();
    await expect(
      campaignTable(page).getByRole("row", { selected: true }),
    ).toContainText("성수점");
  });

  test("상태와 번호 필터가 URL에 남고, 선택은 필터를 바꾸면 비워진다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /망원점 이번 주 특가/ })
      .click();
    const rows = recipientTable(page).locator("[data-row]");
    await expect(rows.first()).toBeVisible();

    await rows.first().getByRole("checkbox").check();
    await expect(page.getByText("1건 선택")).toBeVisible();

    const statusGroup = page.getByRole("group", { name: "수신자 상태" });
    await statusGroup.getByRole("button", { name: /실패/ }).click();

    await expect(page).toHaveURL(/status=failed/);
    await expect(page.getByText("1–8 / 8건")).toBeVisible();
    await expect(rows).toHaveCount(8);
    await expect(page.getByText("건 선택")).toHaveCount(0);
    await expect(rows.first()).toContainText("실패");

    await page.reload();
    await expect(page.getByText("1–8 / 8건")).toBeVisible();

    await page.getByRole("button", { name: "모두 지우기" }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByText("1–100 / 120건")).toBeVisible();

    await page
      .getByRole("searchbox", { name: "수신번호 검색" })
      .fill("010-000");
    // 하이픈을 붙여 넣어도 숫자로 찾는다.
    await expect(page).toHaveURL(/q=010000/);
    await page.getByRole("searchbox", { name: "수신번호 검색" }).fill("99999");
    await expect(page.getByText("조건에 맞는 수신자가 없어요")).toBeVisible();
  });

  test("페이지 크기를 바꾸고 이전·다음으로 이동한다", async ({ page }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /합정점 이번 주 특가/ })
      .click();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();

    await page.getByRole("radio", { name: "50", exact: true }).click();
    await expect(page).toHaveURL(/size=50/);
    await expect(page.getByText("1–50 / 120건")).toBeVisible();
    await expect(page.getByRole("button", { name: "이전" })).toBeDisabled();

    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("51–100 / 120건")).toBeVisible();
    await expect(page).toHaveURL(/page=2/);

    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("101–120 / 120건")).toBeVisible();
    await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();

    // nuqs는 주소를 조금 늦게 쓰므로, 주소가 바뀐 것을 본 뒤에 새로고침한다.
    await expect(page).toHaveURL(/page=3/);

    // 공유 링크처럼 그 주소로 바로 들어와도 같은 위치다.
    await page.reload();
    await expect(page).toHaveURL(/page=3/);
    await expect(page.getByText("101–120 / 120건")).toBeVisible();
    await expect(
      recipientTable(page).locator("[data-row]").last(),
    ).toBeVisible();
  });

  test("지점 역할은 자기 지점 발송 건만 보고 지점 필터가 없다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 합정점/ }).click();
    await expect(page.getByRole("banner")).toContainText("합정점");

    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "발송 내역" })
      .click();

    await expect(campaignTable(page).getByRole("row")).toHaveCount(3);
    await expect(campaignTable(page)).not.toContainText("성수점");
    await expect(page.getByRole("combobox", { name: "지점" })).toHaveCount(0);
    await expect(
      campaignTable(page).getByRole("columnheader", { name: "지점" }),
    ).toHaveCount(0);
  });

  test("다른 지점의 발송 건 주소로 들어와도 수신자가 보이지 않는다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /성수점 이번 주 특가/ })
      .click();
    await expect(page).toHaveURL(/campaign=/);
    const seongsuUrl = page.url();

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 망원점/ }).click();
    await expect(page.getByRole("banner")).toContainText("망원점");

    await page.goto(seongsuUrl);
    await expect(campaignTable(page).getByRole("row")).toHaveCount(3);
    await expect(recipientTable(page)).toHaveCount(0);
  });

  test("태블릿 폭에서도 모든 열을 볼 수 있고 페이지는 가로로 넘치지 않는다", async ({
    page,
  }) => {
    // 접힌 사이드바의 메뉴 이름은 "내역"이라 넓은 화면에서 들어간 뒤 폭을 줄인다.
    await openHistoryAsTrial(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(campaignTable(page).getByRole("row")).toHaveCount(9);
    const row = campaignTable(page).getByRole("row").nth(1);

    const title = row.getByRole("cell").nth(2);
    await expect(title).toBeVisible();
    expect((await title.boundingBox())?.width).toBeGreaterThanOrEqual(180);

    // 표 안에서 가로로 스크롤하면 맨 오른쪽 비용 열까지 닿는다.
    const cost = row.getByRole("cell").last();
    await cost.scrollIntoViewIfNeeded();
    const tableBox = await campaignTable(page).boundingBox();
    const costBox = await cost.boundingBox();
    expect((costBox?.x ?? 0) + (costBox?.width ?? 0)).toBeLessThanOrEqual(
      (tableBox?.x ?? 0) + (tableBox?.width ?? 0) + 1,
    );

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test("잘못된 URL 값이 있어도 화면이 깨지지 않는다", async ({ page }) => {
    await openHistoryAsTrial(page);

    await page.goto("/history?period=1y&ad=x&page=-1&size=999&sort=hack.up");

    await expect(campaignTable(page).getByRole("row")).toHaveCount(9);
    await expect(page.getByRole("radio", { name: "7일" })).toBeChecked();
  });
});
