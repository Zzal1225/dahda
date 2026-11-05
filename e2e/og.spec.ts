import { expect, test } from "@playwright/test";

// 메신저와 SNS는 로그인하지 않고 읽는다. 세션 없는 요청으로 확인한다.
test.describe("링크 미리보기", () => {
  test("첫 주소에 제목, 설명, 이미지 태그가 있다", async ({ page }) => {
    await page.goto("/");
    const content = (property: string) =>
      page.locator(`meta[property="${property}"]`).getAttribute("content");

    expect(await content("og:title")).toContain("dahda");
    expect(await content("og:description")).toContain("문자");
    expect(await content("og:image")).toMatch(/^https:\/\/.+\/opengraph-image/);
    expect(await content("og:image:width")).toBe("1200");
  });

  test("이미지는 로그인 없이 받을 수 있다", async ({ page, request }) => {
    await page.goto("/");
    const image = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    const { pathname, search } = new URL(image ?? "");
    const response = await request.get(`${pathname}${search}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  });
});

test("로그인 화면은 체험 버튼이 입력칸보다 먼저 나온다", async ({ page }) => {
  await page.goto("/login");
  const trial = page.getByRole("button", { name: "로그인 없이 체험하기" });
  const email = page.getByLabel("이메일");
  const trialBox = await trial.boundingBox();
  const emailBox = await email.boundingBox();
  expect(trialBox?.y ?? Infinity).toBeLessThan(emailBox?.y ?? 0);
  // 크기 클래스가 글자색을 지운 적이 있다. 보라 바탕의 글자가 검으면 읽기 어렵다.
  await expect(trial).toHaveCSS("color", "rgb(255, 255, 255)");
});
