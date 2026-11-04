import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const HOME = "http://127.0.0.1:3000/";

async function startTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(HOME);
}

test.describe("체험 계정", () => {
  test("본사는 지점을 추가하고 이름을 바꾼다", async ({ page }) => {
    await startTrial(page);
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "지점 관리" })
      .click();

    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: /성수점/ })).toContainText(
      "₩2,000,000",
    );
    await expect(table.getByRole("row", { name: /합정점/ })).toContainText(
      "잔액 적음",
    );

    // 체험 계정에서는 실제 계정을 만드는 버튼이 없다.
    await expect(page.getByRole("button", { name: "계정 지정" })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "지점 추가" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog.getByText("지점 이름을 입력해 주세요")).toBeVisible();

    await dialog.getByLabel("지점 이름").fill("성수점");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog.getByText("같은 이름의 지점이 있어요")).toBeVisible();

    await dialog.getByLabel("지점 이름").fill("연남점");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(dialog).toBeHidden();
    await expect(table.getByRole("row", { name: /연남점/ })).toContainText(
      "₩0",
    );

    await table
      .getByRole("row", { name: /연남점/ })
      .getByRole("button", { name: "이름 변경" })
      .click();
    await dialog.getByLabel("지점 이름").fill("연남본점");
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(table.getByRole("row", { name: /연남본점/ })).toBeVisible();

    // 상단 바의 역할 메뉴도 바뀐 이름을 보여 준다.
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await expect(
      page.getByRole("menuitemradio", { name: /지점 · 연남본점/ }),
    ).toBeVisible();
  });

  test("지점 역할로 바꾸면 메뉴가 사라지고 주소로도 들어갈 수 없다", async ({
    page,
  }) => {
    await startTrial(page);
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await nav.getByRole("link", { name: "지점 관리" }).click();
    await expect(
      page.getByRole("heading", { name: "지점 관리" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 망원점/ }).click();

    await expect(page).toHaveURL(HOME);
    await expect(nav.getByRole("link", { name: "지점 관리" })).toHaveCount(0);

    await page.goto("/branches");
    await expect(page).toHaveURL(HOME);
  });
});

test.describe("실제 계정", () => {
  const local = JSON.parse(
    execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as { API_URL: string; SECRET_KEY: string };
  const admin = createClient(local.API_URL, local.SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const password = "local-e2e-password";
  const hqEmail = `e2e-hq-${randomUUID()}@example.com`;
  const branchEmail = `e2e-branch-${randomUUID()}@example.com`;
  let hqId: string;
  let orgId: string;

  test.beforeAll(async () => {
    const user = await admin.auth.admin.createUser({
      email: hqEmail,
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    hqId = user.data.user.id;

    const org = await admin
      .from("organizations")
      .insert({ name: "E2E 본사" })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgId = org.data.id;

    const member = await admin.from("members").insert({
      user_id: hqId,
      org_id: orgId,
      role: "hq",
      display_name: "E2E 본사",
    });
    if (member.error) throw new Error(member.error.message);
  });

  test.afterAll(async () => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const users = data.users.filter(
      (u) => u.email === hqEmail || u.email === branchEmail,
    );
    await admin.from("organizations").delete().eq("id", orgId);
    await Promise.all(users.map((u) => admin.auth.admin.deleteUser(u.id)));
  });

  test("본사가 만든 담당 계정은 자기 지점만 보고 지점 관리로 들어갈 수 없다", async ({
    page,
    browser,
  }) => {
    await signIn(page, hqEmail, password);
    await page.goto("/branches");

    // 빈 상태에서 다음 행동을 안내한다.
    await expect(page.getByText("아직 지점이 없어요")).toBeVisible();
    await page.getByRole("button", { name: "첫 지점 추가하기" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("지점 이름").fill("성수점");
    await dialog.getByRole("button", { name: "추가" }).click();

    const row = page.getByRole("table").getByRole("row", { name: /성수점/ });
    await expect(row).toContainText("미지정");

    await row.getByRole("button", { name: "계정 지정" }).click();
    await dialog.getByRole("button", { name: "계정 만들기" }).click();
    await expect(
      dialog.getByText("비밀번호는 8자 이상이어야 해요"),
    ).toBeVisible();

    await dialog.getByLabel("담당자 이름").fill("성수 담당");
    await dialog.getByLabel("이메일").fill(branchEmail);
    await dialog.getByLabel("임시 비밀번호").fill(password);
    await dialog.getByRole("button", { name: "계정 만들기" }).click();

    await expect(row).toContainText("성수 담당");
    // 담당자가 있는 지점에는 다시 지정할 수 없다.
    await expect(row.getByRole("button", { name: "계정 지정" })).toHaveCount(0);

    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
    });
    const branchPage = await context.newPage();
    await signIn(branchPage, branchEmail, password);
    await expect(branchPage.getByRole("banner")).toContainText("성수점");
    await expect(
      branchPage
        .getByRole("navigation", { name: "주 메뉴" })
        .getByRole("link", { name: "지점 관리" }),
    ).toHaveCount(0);

    await branchPage.goto("/branches");
    await expect(branchPage).toHaveURL(HOME);
    await context.close();
  });
});
