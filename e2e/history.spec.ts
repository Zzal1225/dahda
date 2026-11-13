import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/server/db/database.types";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const service = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  env.SUPABASE_SECRET_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** 이 발송 건에서 그 처리 결과(중복 무시·늦은 접수) 기록이 있는 메시지의 번호. */
async function phoneWithEvent(
  campaignId: string,
  outcome: "ignored_final" | "recorded_late",
): Promise<string> {
  const { data, error } = await service
    .from("message_events")
    .select("messages!inner(phone, campaign_id)")
    .eq("outcome", outcome)
    .eq("messages.campaign_id", campaignId)
    .limit(1)
    .single();
  if (error) throw new Error(`기록 조회 실패: ${error.message}`);
  return data.messages.phone;
}

const formatted = (digits: string) =>
  `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;

async function openHistoryAsTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "발송 내역" })
    .click();
  await expect(page.getByRole("heading", { name: "발송 내역" })).toBeVisible();
}

const campaignTable = (page: Page) =>
  page.getByRole("table", { name: "발송 건" });
const recipientTable = (page: Page) =>
  page.getByRole("table", { name: "수신자별 결과" });

test.describe("발송 내역", () => {
  test("발송 건을 고르면 수신자별 결과가 열리고 새로고침해도 유지된다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);

    // 보낸 7건 + 승인 대기·예약·반려 3건. 본사는 전 지점을 본다.
    await expect(campaignTable(page).getByRole("row")).toHaveCount(11);

    await campaignTable(page)
      .getByRole("row", { name: /합정점 \[영업시간 변경/ })
      .click();

    await expect(page).toHaveURL(/campaign=/);
    const rows = recipientTable(page).locator("[data-row]");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();
    await expect(
      page.getByText("결과 확정 · 더 이상 바뀌지 않아요"),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();
    await expect(
      campaignTable(page).getByRole("row", { selected: true }),
    ).toContainText("합정점");
  });

  test("도착 확인증은 보낸 건에만 있고, 모두 도착한 건에만 도장이 찍힌다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    const receipt = page.getByRole("region", { name: "도착 확인증" });
    const stages = receipt
      .getByRole("list", { name: "발송 단계" })
      .getByRole("listitem");

    await campaignTable(page)
      .getByRole("row", { name: /성수점 주말 과일 할인/ })
      .click();
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(3)).toContainText("30건");
    await expect(receipt.getByText("도착 확인", { exact: true })).toBeVisible();
    await expect(receipt).toContainText(/No\. [0-9A-F]{8}/);

    // 실패 3건이 있는 건. 통신사까지 갔으니 통신사 전달은 212, 도착은 209다.
    await campaignTable(page)
      .getByRole("row", { name: /성수점 \[주차장 공사/ })
      .click();
    await expect(stages.nth(2)).toContainText("212건");
    await expect(stages.nth(3)).toContainText("209건");
    await expect(receipt.getByText("도착 확인", { exact: true })).toHaveCount(
      0,
    );
    // 건이 바뀌면 이전 확인증이 남지 않는다.
    await expect(receipt).toHaveCount(1);

    await campaignTable(page)
      .getByRole("row", { name: /합정점 \[정기 점검/ })
      .click();
    await expect(
      recipientTable(page).locator("[data-row]").first(),
    ).toBeVisible();
    await expect(receipt).toHaveCount(0);
  });

  test("상태와 번호 필터가 URL에 남고, 선택은 필터를 바꾸면 비워진다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /망원점 김장 재료/ })
      .click();
    const rows = recipientTable(page).locator("[data-row]");
    await expect(rows.first()).toBeVisible();

    await rows.first().getByRole("checkbox").check();
    await expect(page.getByText("1건 선택")).toBeVisible();

    const statusGroup = page.getByRole("group", { name: "수신자 상태" });
    await statusGroup.getByRole("button", { name: /실패/ }).click();

    await expect(page).toHaveURL(/status=failed/);
    await expect(page.getByText("1–6 / 6건")).toBeVisible();
    await expect(rows).toHaveCount(6);
    await expect(page.getByText("건 선택")).toHaveCount(0);
    await expect(rows.first()).toContainText("실패");

    await page.reload();
    await expect(page.getByText("1–6 / 6건")).toBeVisible();

    await page.getByRole("button", { name: "모두 지우기" }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByText("1–100 / 154건")).toBeVisible();

    await page
      .getByRole("searchbox", { name: "수신번호 검색" })
      .fill("010-000");
    // 하이픈을 붙여 넣어도 숫자로 찾는다.
    await expect(page).toHaveURL(/q=010000/);
    await page.getByRole("searchbox", { name: "수신번호 검색" }).fill("99999");
    await expect(page.getByText("조건에 맞는 수신자가 없어요")).toBeVisible();
  });

  test("페이지 크기를 바꾸고 이전·다음으로 이동한다", async ({ page }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /합정점 \[영업시간 변경/ })
      .click();
    await expect(page.getByText("1–100 / 120건")).toBeVisible();

    await page.getByRole("radio", { name: "50", exact: true }).click();
    await expect(page).toHaveURL(/size=50/);
    await expect(page.getByText("1–50 / 120건")).toBeVisible();
    await expect(page.getByRole("button", { name: "이전" })).toBeDisabled();

    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("51–100 / 120건")).toBeVisible();
    await expect(page).toHaveURL(/page=2/);

    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByText("101–120 / 120건")).toBeVisible();
    await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();

    // nuqs는 주소를 조금 늦게 쓰므로, 주소가 바뀐 것을 본 뒤에 새로고침한다.
    await expect(page).toHaveURL(/page=3/);

    // 공유 링크처럼 그 주소로 바로 들어와도 같은 위치다.
    await page.reload();
    await expect(page).toHaveURL(/page=3/);
    await expect(page.getByText("101–120 / 120건")).toBeVisible();
    await expect(
      recipientTable(page).locator("[data-row]").last(),
    ).toBeVisible();
  });

  test("지점 역할은 자기 지점 발송 건만 보고 지점 필터가 없다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 합정점/ }).click();
    await expect(page.getByRole("banner")).toContainText("합정점");

    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "발송 내역" })
      .click();

    // 합정점은 지난 발송 1건과 예약 1건이다.
    await expect(campaignTable(page).getByRole("row")).toHaveCount(3);
    await expect(campaignTable(page)).not.toContainText("성수점");
    await expect(page.getByRole("combobox", { name: "지점" })).toHaveCount(0);
    await expect(
      campaignTable(page).getByRole("columnheader", { name: "지점" }),
    ).toHaveCount(0);
  });

  test("다른 지점의 발송 건 주소로 들어와도 수신자가 보이지 않는다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /성수점 \[주차장 공사/ })
      .click();
    await expect(page).toHaveURL(/campaign=/);
    const seongsuUrl = page.url();

    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: /지점 · 망원점/ }).click();
    await expect(page.getByRole("banner")).toContainText("망원점");

    await page.goto(seongsuUrl);
    await expect(campaignTable(page).getByRole("row")).toHaveCount(4);
    await expect(recipientTable(page)).toHaveCount(0);
  });

  test("태블릿 폭에서도 모든 열을 볼 수 있고 페이지는 가로로 넘치지 않는다", async ({
    page,
  }) => {
    // 접힌 사이드바의 메뉴 이름은 "내역"이라 넓은 화면에서 들어간 뒤 폭을 줄인다.
    await openHistoryAsTrial(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(campaignTable(page).getByRole("row")).toHaveCount(11);
    const row = campaignTable(page).getByRole("row").nth(1);

    const title = row.getByRole("cell").nth(2);
    await expect(title).toBeVisible();
    expect((await title.boundingBox())?.width).toBeGreaterThanOrEqual(180);

    // 표 안에서 가로로 스크롤하면 맨 오른쪽 비용 열까지 닿는다.
    const cost = row.getByRole("cell").last();
    await cost.scrollIntoViewIfNeeded();
    const tableBox = await campaignTable(page).boundingBox();
    const costBox = await cost.boundingBox();
    expect((costBox?.x ?? 0) + (costBox?.width ?? 0)).toBeLessThanOrEqual(
      (tableBox?.x ?? 0) + (tableBox?.width ?? 0) + 1,
    );

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test("발송 건 상태로 거르면 주소에 남고 상태마다 숫자 대신 안내가 보인다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    const state = page.getByRole("combobox", { name: "발송 건 상태" });

    await state.selectOption({ label: "승인 대기" });
    await expect(page).toHaveURL(/state=pending_approval/);
    await expect(campaignTable(page).getByRole("row")).toHaveCount(2);
    await expect(campaignTable(page)).toContainText("승인 후 발송");

    await state.selectOption({ label: "반려" });
    await campaignTable(page).getByRole("row").nth(1).click();
    await expect(
      page.getByRole("note").filter({ hasText: "반려 사유" }),
    ).toContainText("수신 동의 확인이 필요해요");

    // 보낸 7건 중 성수점 "주말 과일 할인"만 모두 도착했다. 진행 중인 건도 실패가 있으면 잡힌다.
    await state.selectOption({ label: "실패 포함" });
    await expect(campaignTable(page).getByRole("row")).toHaveCount(7);
    await expect(campaignTable(page)).toContainText("실패 18");

    // nuqs는 주소를 조금 늦게 쓰므로, 주소가 바뀐 것을 본 뒤에 새로고침한다.
    await expect(page).toHaveURL(/state=has_failed/);
    await page.reload();
    await expect(state).toHaveValue("has_failed");
  });

  test("수신자 기록에서 중복과 순서가 바뀐 결과를 어떻게 처리했는지 보인다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    await campaignTable(page)
      .getByRole("row", { name: /성수점 \[주차장 공사/ })
      .click();
    const search = page.getByRole("searchbox", { name: "수신번호 검색" });
    // 샘플 수신자는 주소록 사람(무작위 번호)이라, 중복·순서 바뀜 기록이 있는 번호를 DB에서 찾는다.
    await expect(page).toHaveURL(/campaign=/);
    const campaignId = new URL(page.url()).searchParams.get("campaign") ?? "";
    const duplicated = await phoneWithEvent(campaignId, "ignored_final");
    const reordered = await phoneWithEvent(campaignId, "recorded_late");

    // 같은 결과가 두 번 왔다.
    await search.fill(duplicated);
    await expect(page).toHaveURL(new RegExp(`q=${duplicated}`));
    await expect(page.getByText("1–1 / 1건")).toBeVisible();
    await page.getByRole("button", { name: /기록 보기/ }).click();
    const dialog = page.getByRole("dialog");
    const lines = dialog.getByRole("list", { name: "수신자 기록" });
    await expect(lines.getByRole("listitem")).toHaveCount(3);
    await expect(lines).toContainText("이미 확정돼 무시(중복)");
    await page.keyboard.press("Escape");

    // 결과 웹훅이 접수 기록보다 먼저 왔다.
    await search.fill(reordered);
    await expect(page).toHaveURL(new RegExp(`q=${reordered}`));
    // 앞 검색의 행이 남아 있을 때 누르지 않도록 번호로 고른다.
    await page
      .getByRole("button", { name: `${formatted(reordered)} 기록 보기` })
      .click();
    await expect(lines.getByRole("listitem").first()).toContainText("웹훅");
    await expect(lines).toContainText("결과가 먼저 와서 접수 정보만 채움");
    await expect(lines).toContainText("순서 바뀜");
  });

  test("문자 종류로 거르면 주소와 칩에 남고 두 종류를 합치면 전체와 같다", async ({
    page,
  }) => {
    await openHistoryAsTrial(page);
    const kind = page.getByRole("combobox", { name: "문자 종류" });
    const rows = campaignTable(page).getByRole("row");
    // 머리글 1행 + 체험 샘플 10건. 그중 본사의 LMS가 2건이다.
    await expect(rows).toHaveCount(11);

    await kind.selectOption("lms");
    await expect(page).toHaveURL(/kind=lms/);
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      await expect(row).not.toContainText("SMS");
    }
    await expect(
      page.getByRole("button", { name: "LMS 필터 지우기" }),
    ).toBeVisible();

    await kind.selectOption("sms");
    await expect(page).toHaveURL(/kind=sms/);
    await expect(rows).toHaveCount(9);

    await page.getByRole("button", { name: "SMS 필터 지우기" }).click();
    await expect(page).not.toHaveURL(/kind=/);
    await expect(rows).toHaveCount(11);
  });

  test("잘못된 URL 값이 있어도 화면이 깨지지 않는다", async ({ page }) => {
    await openHistoryAsTrial(page);

    await page.goto(
      "/history?period=1y&ad=x&kind=mms&page=-1&size=999&sort=hack.up",
    );

    await expect(campaignTable(page).getByRole("row")).toHaveCount(11);
    await expect(page.getByRole("radio", { name: "7일" })).toBeChecked();
  });
});
