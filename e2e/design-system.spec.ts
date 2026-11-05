import { expect, test } from "@playwright/test";

test.describe("디자인 시스템", () => {
  test("로그인 없이 토큰과 컴포넌트를 볼 수 있다", async ({ page }) => {
    await page.goto("/design-system");
    await expect(page).toHaveURL(/\/design-system/);
    await expect(
      page.getByRole("heading", { name: "디자인 시스템" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "색" })).toContainText(
      "--primary",
    );
    await expect(page.getByRole("region", { name: "상태" })).toContainText(
      "승인 대기",
    );
    await expect(page.getByRole("table", { name: "표 샘플" })).toBeVisible();
  });

  test("샘플이 실제로 동작한다", async ({ page }) => {
    await page.goto("/design-system");
    await page.getByRole("radio", { name: "30일" }).click();
    await expect(page.getByRole("radio", { name: "30일" })).toBeChecked();

    await page.getByRole("button", { name: "확인 대화상자 열기" }).click();
    await page.getByRole("button", { name: "진행", exact: true }).click();
    await expect(page.getByText("진행했어요")).toBeVisible();
  });

  test("공개 화면이라 데이터베이스를 읽지 않는다", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(":54321")) requests.push(request.url());
    });
    await page.goto("/design-system");
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual([]);
  });
});
