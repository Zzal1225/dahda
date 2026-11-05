import { expect, test } from "@playwright/test";

// 실제 문자는 나가지 않는다. 이 테스트는 워커를 돌리지 않고, 워커도 CI에서는 가짜 발송기다.
// 번호당 1회 제한이 있어 실행마다 번호를 새로 만든다.
const uniquePhone = () =>
  `010${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`;

test.describe("실제 문자 받아 보기", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await page.getByRole("link", { name: "실제로 문자 발송하기" }).click();
    await expect(page).toHaveURL(/\/demo-sms/);
  });

  test("번호와 동의가 없으면 확인 창을 열지 않는다", async ({ page }) => {
    await page.getByRole("button", { name: "실제 문자 받아 보기" }).click();
    await expect(page.getByText("휴대전화 번호를 확인해 주세요")).toBeVisible();
    await expect(
      page.getByText("본인 번호로 받는 데 동의해 주세요"),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("본문은 입력할 수 없고, 보내면 발송 내역으로 가며 두 번째는 막힌다", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "보낼 내용" })).toContainText(
      "포트폴리오 체험 문자",
    );

    const send = async (phone: string) => {
      await page.getByLabel("내 휴대전화 번호").fill(phone);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "실제 문자 받아 보기" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "보내기" })
        .click();
    };

    await send(uniquePhone());
    await expect(page).toHaveURL(/\/history\?campaign=/);
    await expect(
      page.getByRole("table", { name: "발송 건" }).getByRole("row", {
        selected: true,
      }),
    ).toContainText("포트폴리오 체험 문자");

    await page.goto("/demo-sms");
    await send(uniquePhone());
    await expect(page.getByRole("alertdialog")).toContainText("이미 보냈어요");
  });
});
