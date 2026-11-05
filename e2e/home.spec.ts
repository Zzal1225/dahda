import { expect, test } from "@playwright/test";

test.describe("첫 화면", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(page.getByRole("heading", { name: "홈" })).toBeVisible();
  });

  test("본사는 오늘 숫자, 승인 대기, 지점별 잔액, 최근 발송을 본다", async ({
    page,
  }) => {
    for (const name of ["오늘 발송", "오늘 도착률", "잔액"]) {
      await expect(
        page.getByRole("region", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "오늘 도착률" }),
    ).toContainText("확인 중");
    await expect(page.getByRole("region", { name: "승인 대기" })).toContainText(
      "승인을 기다리는 지점 광고",
    );
    await expect(
      page.getByRole("region", { name: "지점별 잔액" }),
    ).toContainText("성수점");
    await expect(page.getByRole("table", { name: "최근 발송" })).toBeVisible();
  });

  test("문자 작성과 전체 보기로 이동한다", async ({ page }) => {
    await page.getByRole("link", { name: "전체 보기" }).click();
    await expect(page).toHaveURL(/\/history/);
    await page.goBack();
    await page
      .getByRole("main")
      .getByRole("link", { name: "문자 작성", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/compose/);
  });
});
