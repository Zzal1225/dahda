import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.describe("체험하기", () => {
  test("체험을 시작하고 역할을 바꾸면 범위와 잔액이 함께 바뀐다", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();

    await expect(page).toHaveURL("http://127.0.0.1:3000/");
    await expect(page.getByRole("note")).toContainText(
      "문자 작성은 가짜 발송기로 처리돼요",
    );
    const header = page.getByRole("banner");
    await expect(header).toContainText("전체 지점");
    await expect(header).toContainText("₩8,500,000");

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 합정점/ }).click();

    await expect(header).toContainText("합정점");
    await expect(header).toContainText("₩864,200");
    // 100만 원 미만 기준(핸드오프)
    await expect(header).toContainText("잔액 적음");

    // 화면 상태만 바뀐 가짜 전환이면 새로고침에서 되돌아간다.
    await page.reload();
    await expect(header).toContainText("합정점");
    await expect(header).toContainText("₩864,200");

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /본사 관리자/ }).click();
    await expect(header).toContainText("전체 지점");
    await expect(header).toContainText("₩8,500,000");
  });

  test("로그아웃하면 다시 로그인 화면으로 간다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(page.getByRole("note")).toBeVisible();

    await page.getByRole("button", { name: "내 계정" }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("이메일 로그인", () => {
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
  let email: string;
  let userId: string;
  let orgId: string;

  test.beforeAll(async () => {
    email = `e2e-${randomUUID()}@example.com`;
    const user = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userId = user.data.user.id;

    const org = await admin
      .from("organizations")
      .insert({ name: "E2E 본사" })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgId = org.data.id;

    const member = await admin.from("members").insert({
      user_id: userId,
      org_id: orgId,
      role: "hq",
      display_name: "정우진",
    });
    if (member.error) throw new Error(member.error.message);
  });

  test.afterAll(async () => {
    await admin.from("organizations").delete().eq("id", orgId);
    await admin.auth.admin.deleteUser(userId);
  });

  test("형식이 틀리면 서버에 보내지 않고 안내한다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await expect(page.getByText("이메일 형식을 확인해 주세요")).toBeVisible();
    await expect(page.getByText("비밀번호를 입력해 주세요")).toBeVisible();
  });

  test("비밀번호가 틀리면 어느 쪽이 틀렸는지 구분하지 않고 안내한다", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill("wrong-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    // Next의 경로 안내 요소도 role=alert라 내용으로 좁힌다.
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "이메일 또는 비밀번호가 맞지 않아요" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("실제 계정에는 체험 띠와 역할 전환이 없다", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await expect(page).toHaveURL("http://127.0.0.1:3000/");
    await expect(page.getByRole("heading", { name: "홈" })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("₩0");
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /역할 전환/ })).toHaveCount(
      0,
    );

    // 로그인한 사용자는 로그인 화면에 머물지 않는다.
    await page.goto("/login");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
  });

  test("소속 없는 계정은 순환 없이 로그인 화면에 머문다", async ({ page }) => {
    const orphanEmail = `e2e-${randomUUID()}@example.com`;
    const orphan = await admin.auth.admin.createUser({
      email: orphanEmail,
      password,
      email_confirm: true,
    });
    if (orphan.error || !orphan.data.user)
      throw new Error(orphan.error?.message);

    try {
      await page.goto("/login");
      await page.getByLabel("이메일").fill(orphanEmail);
      await page.getByLabel("비밀번호").fill(password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByRole("button", { name: "로그인", exact: true }),
      ).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(orphan.data.user.id);
    }
  });
});

test.describe("화면 폭", () => {
  test("모바일 폭에서는 PC 안내를 보여 준다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();

    await expect(page.getByText("PC에서 열어 주세요")).toBeVisible();
    await expect(page.getByRole("banner")).toBeHidden();
  });

  test("태블릿 폭에서는 사이드바가 접힌다", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();

    await expect(page.getByRole("complementary")).toHaveCSS("width", "64px");
  });
});
