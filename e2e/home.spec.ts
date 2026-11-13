import { expect, test } from "@playwright/test";

test.describe("첫 화면", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /관리자|담당자/ }),
    ).toBeVisible();
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

test.describe("발송 추이", () => {
  const toNumber = (text: string) => Number(text.replace(/[^0-9]/g, ""));

  test("표의 칸 합이 위 합계와 같고, 오늘 칸은 오늘 발송 숫자와 같다", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    const trend = page.getByRole("region", { name: "발송 추이" });
    await expect(
      trend.getByRole("img", { name: /최근 30일 발송 추이 막대 차트/ }),
    ).toBeVisible();
    // 차트는 화면이 뜬 뒤 따로 불러온다(next/dynamic). 막대까지 그려지는지 본다.
    await expect(
      trend.locator(".recharts-bar-rectangle path").first(),
    ).toBeVisible();

    const statOf = (label: string) =>
      trend
        .locator("dt", { hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::dd");
    const total = toNumber(await statOf("총 발송").innerText());
    expect(total).toBeGreaterThan(0);
    const today = toNumber(
      (await page
        .getByRole("region", { name: "오늘 발송", exact: true })
        .innerText()
        .then((text) => /([0-9,]+)\s*건/.exec(text)?.[1])) ?? "",
    );

    await trend.getByRole("button", { name: "표로 보기" }).click();
    await expect(
      trend.getByRole("button", { name: "표로 보기" }),
    ).toHaveAttribute("aria-pressed", "true");
    const rows = trend.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(30);

    // 최신이 위. 첫 줄의 첫 숫자 칸이 오늘 총 발송이다.
    const firstCells = rows.first().getByRole("cell");
    expect(toNumber(await firstCells.first().innerText())).toBe(today);

    const totals = await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.querySelector("td")?.textContent ?? "0"),
    );
    expect(totals.reduce((sum, text) => sum + toNumber(text), 0)).toBe(total);

    await trend.getByRole("radio", { name: "월별 12개월" }).click();
    await expect(rows).toHaveCount(12);
    await expect(rows.first().getByRole("rowheader")).toHaveText(
      /^\d{4}년 \d{1,2}월$/,
    );
    // 체험 샘플은 모두 최근에 나갔다. 월별 합계도 같은 숫자여야 한다.
    expect(toNumber(await statOf("총 발송").innerText())).toBe(total);
  });
});
