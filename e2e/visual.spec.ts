import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 핵심 화면 4개 × 1280·1440 화면 비교. 글꼴 렌더링이 OS마다 달라 기준 이미지는 CI와 같은 Linux 것만 둔다.
 * 다른 OS에서는 건너뛴다. 기준을 바꾸려면 CI 실패 시 올라오는 playwright-traces의 이미지를 받아 교체한다.
 *
 * 체험 샘플은 시각이 매번 다르고, 같은 시각에 만든 발송 건의 순서도 정해져 있지 않다.
 * 그 부분은 가려서 레이아웃과 스타일만 비교한다.
 */
test.skip(
  process.platform !== "linux" && !process.env.VISUAL_ANY_OS,
  "기준 이미지는 Linux 전용",
);

const WIDTHS = [1280, 1440] as const;

/** 머리글은 남기고 본문 행만 가린다. 전체를 가리면 표 스타일이 바뀌어도 잡지 못한다. */
const bodyRows = (page: Page) =>
  page.locator('[role="table"] [role="row"]:not([role="rowgroup"].sticky > *)');

const SCREENS: {
  name: string;
  path: string;
  ready: (page: Page) => Locator;
  mask: (page: Page) => Locator[];
  /** 찍기 전에 화면을 고정한다. 가리기는 높이를 못 잡으므로 줄 수가 달라지는 곳에 쓴다. */
  prepare?: (page: Page) => Promise<unknown>;
}[] = [
  {
    name: "home",
    path: "/",
    ready: (page) => page.getByRole("table", { name: "최근 발송" }),
    mask: (page) => [
      // 제목에 오늘 날짜가 들어가 매일 달라진다.
      page.getByRole("heading", { level: 1 }),
      page.getByRole("region", { name: "진행 중인 발송" }).getByRole("list"),
      bodyRows(page),
    ],
  },
  {
    name: "history",
    path: "/history",
    ready: (page) => page.getByRole("heading", { name: "발송 내역" }),
    mask: (page) => [bodyRows(page), page.locator("input, select")],
  },
  {
    name: "compose",
    path: "/compose",
    ready: (page) => page.getByRole("heading", { name: "문자 작성" }),
    // 체험 샘플의 그룹은 지점마다 4~5개이고 이름과 인원도 무작위라 페이지 높이가 계정마다 다르다.
    // 기준 이미지만 바꾸면 다음 실행에서 또 깨진다. 3개 지점의 최소인 12줄 안에서 6줄만 남기고
    // 글자를 숨겨, 체크박스와 줄 간격은 계속 비교한다.
    // mask를 쓰지 않는 이유: 가림 상자가 글자 폭을 따라가 이름 길이에 따라 결과가 달라진다.
    prepare: (page) =>
      page.addStyleTag({
        content: `
          [aria-label="받는 그룹"] > li:nth-child(n + 7) { display: none; }
          [aria-label="받는 그룹"] label > span { visibility: hidden; }
        `,
      }),
    mask: (page) => [page.locator("select")],
  },
  {
    name: "approvals",
    path: "/approvals",
    ready: (page) => page.getByRole("heading", { level: 1 }),
    mask: () => [],
  },
];

test.describe("화면 비교", () => {
  for (const width of WIDTHS) {
    test(`핵심 화면 ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: /관리자|담당자/ }),
      ).toBeVisible();

      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(screen.ready(page)).toBeVisible();
        // 글꼴이 늦게 오면 글자 폭이 달라져 비교가 흔들린다.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState("networkidle").catch(() => {});
        await screen.prepare?.(page);
        await expect(page).toHaveScreenshot(`${screen.name}-${width}.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          mask: screen.mask(page),
          // 안티에일리어싱 차이는 넘기고, 카드나 표가 움직이면 잡히는 정도다.
          maxDiffPixelRatio: 0.005,
          timeout: 15_000,
        });
      }
    });
  }
});
