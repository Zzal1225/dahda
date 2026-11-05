import { expect, test } from "@playwright/test";

// 토스 결제창은 외부 화면이라 CI에서 끝까지 진행하지 않는다.
// 승인 경로는 단위·통합 테스트가 보고, 실제 결제는 테스트 키로 사람이 확인한다.
test.describe("충전", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await page.getByRole("link", { name: "충전", exact: true }).first().click();
    await expect(page).toHaveURL(/\/billing/);
  });

  test("금액 버튼 네 개와 테스트 결제 안내, 거래 내역을 보여 준다", async ({
    page,
  }) => {
    const panel = page.getByRole("region", { name: "충전", exact: true });
    await expect(panel.getByRole("button")).toHaveCount(4);
    await expect(panel).toContainText("실제 출금은 없어요");
    await expect(page.getByRole("table", { name: "거래 내역" })).toBeVisible();
  });

  test("본사는 지점 잔액을 볼 수 있지만 지점 계정을 충전할 수 없다", async ({
    page,
  }) => {
    const branches = page.getByRole("region", { name: "지점 잔액" });
    await branches.getByRole("link", { name: /성수점/ }).click();
    await expect(page).toHaveURL(/branch=/);
    await expect(
      page.getByRole("region", { name: "잔액", exact: true }),
    ).toContainText("성수점 잔액");
    await expect(
      page.getByRole("region", { name: "충전", exact: true }),
    ).toHaveCount(0);
  });

  test("주소를 꾸며 승인 경로로 와도 충전되지 않는다", async ({ page }) => {
    const before = await page
      .getByRole("region", { name: "잔액", exact: true })
      .textContent();
    await page.goto(
      "/api/payments/confirm?paymentKey=fake&orderId=dh-fake&amount=100000",
    );
    await expect(page).toHaveURL(/\/billing\?result=failed/);
    await expect(page.getByRole("status")).toContainText("결제하지 못했어요");
    await expect(
      page.getByRole("region", { name: "잔액", exact: true }),
    ).toHaveText(before ?? "");
  });

  test("결제창을 불러오지 못하면 오류를 보여 주고 다시 누를 수 있다", async ({
    page,
  }) => {
    await page.route("**/js.tosspayments.com/**", (route) => route.abort());
    const panel = page.getByRole("region", { name: "충전", exact: true });
    await panel.getByRole("button").first().click();
    await expect(panel.getByRole("alert")).toContainText("결제창을 열지");
    await expect(panel.getByRole("button").first()).toBeEnabled();
  });
});
