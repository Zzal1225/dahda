import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";

const startTrial = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("heading", { name: "홈" })).toBeVisible();
};

test.describe("설정", () => {
  test("내 정보와 발신번호를 보여 주고 로그아웃할 수 있다", async ({
    page,
  }) => {
    await startTrial(page);
    await page.getByRole("link", { name: "설정", exact: true }).first().click();
    await expect(page.getByRole("region", { name: "내 정보" })).toContainText(
      "체험",
    );
    await expect(page.getByRole("table", { name: "발신번호" })).toBeVisible();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("처리방침은 로그인 없이 읽을 수 있다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "개인정보처리방침" }).click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(
      page.getByRole("heading", { name: "보관 기간" }),
    ).toBeVisible();
  });
});

test.describe("엑셀 내보내기", () => {
  test("본사는 조건에 맞는 주소록을 받는다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/contacts");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "엑셀 내보내기" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("dahda-contacts.xlsx");
    const book = XLSX.readFile(await download.path());
    const sheet = book.Sheets["주소록"];
    if (!sheet) throw new Error("시트 없음");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(rows[0]).toContain("전화번호");
    expect(rows.length).toBeGreaterThan(1);
    expect(String(rows[1]?.[1])).toMatch(/^0/);
  });

  test("지점은 버튼이 없고 주소로 와도 받을 수 없다", async ({ page }) => {
    await startTrial(page);
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 합정점/ }).click();
    await expect(page.getByRole("banner")).toContainText("합정점");
    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "엑셀 내보내기" })).toHaveCount(
      0,
    );
    const response = await page.request.get("/api/contacts/export", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers()["content-type"] ?? "").not.toContain(
      "spreadsheetml",
    );
  });
});
