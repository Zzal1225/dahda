import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

async function startTrial(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
}

async function openUploadAsBranch(page: Page, branch: string) {
  await startTrial(page);
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name: `지점 · ${branch}` }).click();
  await expect(page.getByRole("banner")).toContainText(branch);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "엑셀 업로드" }).click();
  await expect(page.getByRole("button", { name: "파일 선택" })).toBeVisible();
}

function xlsxFile(rows: unknown[][], name = "연락처.xlsx") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "시트");
  return {
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
  };
}

const fileInput = (page: Page) => page.getByLabel("업로드할 파일");
const preview = (page: Page) =>
  page.getByRole("table", { name: "첫 5행 미리보기" });
const result = (page: Page) =>
  page.getByRole("region", { name: "업로드 결과" });

/** 상세(드로어)에서 전체 번호를 읽는다. 체험 번호는 무작위라 화면에서 가져온다. */
async function phoneOfStatus(page: Page, status: "opted_out" | "consented") {
  await page.goto(`/contacts?status=${status}`);
  await page
    .getByRole("table", { name: "연락처" })
    .locator("[data-row]")
    .first()
    .click();
  const text = await page
    .getByRole("dialog")
    .locator("dt", { hasText: "전화번호" })
    .locator("xpath=following-sibling::dd")
    .innerText();
  await page.keyboard.press("Escape");
  return text.trim();
}

test.describe("엑셀 업로드", () => {
  test("미리보기·열 매핑을 거쳐 분류하고, 그룹 칸대로 넣고, 결과를 요약한다", async ({
    page,
  }) => {
    await startTrial(page);
    await page.getByRole("button", { name: /역할 전환/ }).click();
    await page.getByRole("menuitemradio", { name: "지점 · 성수점" }).click();
    await expect(page.getByRole("banner")).toContainText("성수점");
    const existing = await phoneOfStatus(page, "consented");
    const optedOut = await phoneOfStatus(page, "opted_out");

    await page.goto("/contacts");
    await page.getByRole("button", { name: "엑셀 업로드" }).click();
    // 머리글이 없는 열 이름이라 자동 짐작이 안 되는 파일. 매핑에서 직접 고른다.
    await fileInput(page).setInputFiles(
      xlsxFile([
        ["고객", "연락", "분류", "비고"],
        ["새손님1", "010-0000-7001", "단골, 봄 행사", "주말"],
        // 숫자로 저장되어 맨 앞 0이 사라진 칸
        ["새손님2", 1000007002, null, null],
        ["새손님3", "잘못된번호", null, null],
        ["파일 안 중복", "010-0000-7001", null, null],
        ["이미 있는 번호", existing, null, null],
        ["수신거부 번호", optedOut, null, null],
      ]),
    );

    await expect(preview(page)).toBeVisible();
    await expect(preview(page).locator("[data-row]")).toHaveCount(5);
    // 사라진 0을 되살려 보여 준다.
    await expect(preview(page)).toContainText("01000007002");

    await page.getByRole("button", { name: /^이름 열:/ }).click();
    await page.getByRole("menuitemradio", { name: "A · 고객" }).click();
    await page.getByRole("button", { name: /^그룹 열:/ }).click();
    await page.getByRole("menuitemradio", { name: "C · 분류" }).click();
    // 전화번호를 고르기 전에는 시작할 수 없다.
    await expect(page.getByRole("alert")).toContainText(
      "전화번호 열을 골라 주세요",
    );
    await page.getByRole("button", { name: /^전화번호 열:/ }).click();
    await page.getByRole("menuitemradio", { name: "B · 연락" }).click();
    await page.getByRole("button", { name: "6행 처리 시작" }).click();

    await expect(result(page)).toContainText("2명을 추가했어요");
    await expect(result(page).getByRole("status")).toHaveText(
      /^추가 2 · 중복 2 · 형식 오류 1 · 수신거부 제외 1 · 처리 시간 [0-9.]+초$/,
    );
    await expect(
      result(page).getByRole("button", { name: "오류 행 받기 (4행)" }),
    ).toBeVisible();

    const download = page.waitForEvent("download");
    await result(page)
      .getByRole("button", { name: /오류 행 받기/ })
      .click();
    expect((await download).suggestedFilename()).toBe("업로드-오류-행.xlsx");

    await result(page).getByRole("button", { name: "닫기" }).click();
    // 그룹 칸의 "봄 행사"는 없던 그룹이라 새로 만들었다.
    const nav = page.getByRole("navigation", { name: "그룹" });
    await expect(
      nav.getByRole("button", { name: "봄 행사 1명" }),
    ).toBeVisible();
    await page.goto("/contacts?q=7001");
    const row = page
      .getByRole("table", { name: "연락처" })
      .locator("[data-row]")
      .first();
    await expect(row).toContainText("새손님1");
    await expect(row).toContainText("단골");
    await expect(row).toContainText("봄 행사");
  });

  test("같은 파일을 다시 올리면 전부 중복으로 나온다", async ({ page }) => {
    await openUploadAsBranch(page, "망원점");
    const file = xlsxFile([["전화번호"], ["010-0000-7101"], ["010-0000-7102"]]);

    await fileInput(page).setInputFiles(file);
    await page.getByRole("button", { name: "2행 처리 시작" }).click();
    await expect(result(page)).toContainText("2명을 추가했어요");

    await result(page)
      .getByRole("button", { name: "다른 파일 올리기" })
      .click();
    await fileInput(page).setInputFiles(file);
    await page.getByRole("button", { name: "2행 처리 시작" }).click();
    await expect(result(page)).toContainText("0명을 추가했어요");
    await expect(result(page)).toContainText("중복 2");
  });

  test("한국어 Excel의 CP949 CSV를 읽는다", async ({ page }) => {
    await openUploadAsBranch(page, "합정점");

    // "전화번호,이름" + 줄바꿈 + 번호와 "김" (CP949)
    const header = [0xc0, 0xfc, 0xc8, 0xad, 0xb9, 0xf8, 0xc8, 0xa3, 0x2c];
    const name = [0xc0, 0xcc, 0xb8, 0xa7];
    const line = Buffer.from("\n010-0000-7201,", "ascii");
    const kim = [0xb1, 0xe8];
    await fileInput(page).setInputFiles({
      name: "연락처.csv",
      mimeType: "text/csv",
      buffer: Buffer.concat([
        Buffer.from(header),
        Buffer.from(name),
        line,
        Buffer.from(kim),
      ]),
    });

    await expect(preview(page)).toContainText("김");
    await page.getByRole("button", { name: "1행 처리 시작" }).click();
    await expect(result(page)).toContainText("1명을 추가했어요");
  });

  test("본사는 넣을 지점을 고른 뒤에 처리할 수 있다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/contacts");
    await page.getByRole("button", { name: "엑셀 업로드" }).click();
    await fileInput(page).setInputFiles(
      xlsxFile([["전화번호"], ["010-0000-7401"]]),
    );

    await expect(page.getByRole("alert")).toContainText(
      "넣을 지점을 골라 주세요",
    );
    await expect(
      page.getByRole("button", { name: "1행 처리 시작" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /^넣을 지점:/ }).click();
    await page.getByRole("menuitemradio", { name: "합정점" }).click();
    await page.getByRole("button", { name: "1행 처리 시작" }).click();
    await expect(result(page)).toContainText("1명을 추가했어요");

    await result(page).getByRole("button", { name: "닫기" }).click();
    await page.goto("/contacts?q=7401");
    await expect(
      page.getByRole("table", { name: "연락처" }).locator("[data-row]").first(),
    ).toContainText("합정점");
  });

  test("체험용 샘플 엑셀은 1만 행이다", async ({ page }) => {
    await openUploadAsBranch(page, "성수점");
    const download = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "체험용 샘플 엑셀(1만 행) 받기" })
      .click();
    const file = await (await download).path();
    const book = XLSX.readFile(file);
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    expect(sheet).toBeDefined();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1 });
    expect(rows).toHaveLength(10_001);
  });

  test.describe("거부", () => {
    test.beforeEach(async ({ page }) => {
      await openUploadAsBranch(page, "성수점");
    });

    test("지원하지 않는 형식을 거부한다", async ({ page }) => {
      await fileInput(page).setInputFiles({
        name: "메모.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      });
      await expect(
        page.getByText("엑셀(.xlsx, .xls) 또는 CSV 파일만 올릴 수 있어요"),
      ).toBeVisible();
    });

    test("손상된 파일에도 화면이 멈추지 않는다", async ({ page }) => {
      await fileInput(page).setInputFiles({
        name: "손상.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("not a real workbook"),
      });
      await expect(
        page.getByRole("button", { name: "파일 선택" }),
      ).toBeVisible();
      await expect(page.getByRole("alert").first()).not.toBeEmpty();
    });

    test("5MB를 넘는 파일을 거부한다", async ({ page }) => {
      await fileInput(page).setInputFiles({
        name: "큰파일.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      });
      await expect(
        page.getByText("파일은 5MB까지 올릴 수 있어요"),
      ).toBeVisible();
    });
  });

  test("예전 업로드 주소는 주소록으로 이어진다", async ({ page }) => {
    await startTrial(page);
    await page.goto("/contacts/upload");
    await expect(page).toHaveURL(/\/contacts$/);
  });

  test("파일을 읽는 동안 취소하면 Worker를 멈추고 처음으로 돌아간다", async ({
    page,
  }) => {
    // Worker가 실제로 일하면 취소 버튼을 누르기 전에 끝날 수 있어, 응답하지 않는 Worker로 바꾼다.
    await page.addInitScript(() => {
      const state = { terminated: false };
      Object.assign(window, { __workerState: state });
      window.Worker = class {
        onmessage = null;
        onerror = null;
        postMessage() {}
        terminate() {
          state.terminated = true;
        }
      } as unknown as typeof Worker;
    });
    await openUploadAsBranch(page, "성수점");

    await fileInput(page).setInputFiles(
      xlsxFile([["전화번호"], ["010-0000-7301"]]),
    );
    await page.getByRole("button", { name: "읽기 취소" }).click();

    await expect(page.getByRole("button", { name: "파일 선택" })).toBeVisible();
    await expect(preview(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __workerState: { terminated: boolean } })
            .__workerState.terminated,
      ),
    ).toBe(true);
  });
});
