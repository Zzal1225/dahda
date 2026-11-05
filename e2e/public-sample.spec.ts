import { expect, test, type Page } from "@playwright/test";

// CI와 로컬 모두 seed_public_sample을 먼저 실행해 둔다.
async function openSample(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
  await page.goto("/history");
  await page.getByRole("link", { name: "10만 행 샘플 보기" }).click();
  await expect(page).toHaveURL(/\/history\/sample/);
  await expect(
    page.getByRole("heading", { name: "100,000행 샘플" }),
  ).toBeVisible();
}

test.describe("공용 10만 행 샘플", () => {
  test("표를 스크롤하면 필요한 행만 받아 뒤쪽까지 볼 수 있다", async ({
    page,
  }) => {
    await openSample(page);
    const table = page.getByRole("table").first();
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    // 가상화: 10만 행이 있어도 DOM에는 일부만 있다.
    expect(await table.getByRole("row").count()).toBeLessThan(100);

    await table.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    // 최신순이라 맨 끝이 첫 번째 번호다. 뒤쪽 페이지를 실제로 받았다는 뜻이다.
    await expect(table.getByText("010-0000-0000")).toBeVisible();
    expect(await table.getByRole("row").count()).toBeLessThan(100);
  });

  test("읽기 전용이라 선택 칸과 재발송이 없다", async ({ page }) => {
    await openSample(page);
    await expect(
      page.getByRole("table").first().getByRole("row").nth(1),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /재발송|다시 보내/ }),
    ).toHaveCount(0);
  });

  test("상태로 거르면 주소에 남고 해당 행만 보인다", async ({ page }) => {
    await openSample(page);
    await page.getByRole("radio", { name: "실패" }).click();
    await expect(page).toHaveURL(/status=failed/);
    const rows = page.getByRole("table").first();
    await expect(rows.getByText("실패").first()).toBeVisible();
    await expect(rows.getByText("도착")).toHaveCount(0);
  });

  test("조회 경로는 입력한 발송 건 id를 무시하고 샘플만 준다", async ({
    page,
  }) => {
    await openSample(page);
    const response = await page.request.get(
      "/api/messages/sample?campaignId=00000000-0000-4000-8000-000000000000&limit=5",
    );
    expect(response.status()).toBe(200);
    const { rows } = (await response.json()) as {
      rows: { phone: string }[];
    };
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.phone).toMatch(/^0100/);
  });

  test("샘플이 내 첫 화면 숫자와 잔액에 섞이지 않는다", async ({ page }) => {
    await openSample(page);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "오늘 발송", exact: true }),
    ).toContainText("480");
    await expect(page.getByRole("banner")).toContainText("₩8,500,000");
    await page.goto("/history");
    await expect(page.getByText("10만 행을 확인하는")).toHaveCount(0);
  });

  test("로그인 없이는 조회할 수 없다", async ({ request }) => {
    const response = await request.get("/api/messages/sample", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
  });
});
