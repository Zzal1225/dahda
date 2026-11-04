import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

async function openUploadAsBranch(page: Page, branch: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page.getByRole("note")).toBeVisible();
  await page.getByRole("button", { name: /역할 전환/ }).click();
  await page.getByRole("menuitemradio", { name: `지점 · ${branch}` }).click();
  await expect(page.getByRole("banner")).toContainText(branch);
  await page.goto("/contacts");
  await page.getByRole("link", { name: "엑셀 업로드" }).click();
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
const card = (page: Page, label: string) =>
  page.getByRole("group", { name: label, exact: true });

test.describe("엑셀 업로드", () => {
  test("행을 분류하고, 형식 오류를 고쳐 저장한다", async ({ page }) => {
    await openUploadAsBranch(page, "성수점");

    await fileInput(page).setInputFiles(
      xlsxFile([
        ["전화번호", "이름", "메모"],
        ["010-0000-7001", "새손님1", "주말"],
        // 숫자로 저장되어 맨 앞 0이 사라진 칸
        [1000007002, "새손님2", null],
        ["잘못된번호", "새손님3", null],
        ["010-0000-7001", "파일 안 중복", null],
        ["010-0000-0001", "이미 있는 번호", null],
        ["010-0000-0007", "수신거부 번호", null],
      ]),
    );

    await expect(card(page, "저장할 수 있어요")).toContainText("2");
    await expect(card(page, "형식 오류")).toContainText("1");
    await expect(card(page, "중복")).toContainText("2");
    await expect(card(page, "수신거부")).toContainText("1");

    const problems = page.getByRole("table", { name: "확인이 필요한 행" });
    await expect(problems).toContainText("2번째 줄과 같은 번호예요");
    await expect(problems).toContainText("이미 주소록에 있어요");
    await expect(problems).toContainText("수신거부한 번호예요");

    await page.getByLabel("4번째 줄 전화번호").fill("010-0000-7003");
    await page.getByRole("button", { name: "고친 내용 확인" }).click();
    await expect(card(page, "저장할 수 있어요")).toContainText("3");
    await expect(card(page, "형식 오류")).toContainText("0");

    await page.getByRole("combobox", { name: "저장할 그룹" }).selectOption({
      label: "단골 손님",
    });
    await page.getByRole("button", { name: "3명 저장" }).click();

    await expect(page.getByText("3명을 저장했어요")).toBeVisible();
    await expect(
      page.getByText("문제가 있는 3행은 저장하지 않았어요"),
    ).toBeVisible();

    await page.getByRole("link", { name: "주소록 보기" }).click();
    await expect(page.getByText("1–50 / 63명")).toBeVisible();
    await page.goto("/contacts?q=01000007002");
    const row = page
      .getByRole("table", { name: "연락처" })
      .getByRole("row", { name: /새손님2/ });
    await expect(row).toContainText("010-0000-7002");
    await expect(row).toContainText("단골 손님");
  });

  test("같은 파일을 다시 올리면 전부 중복으로 나온다", async ({ page }) => {
    await openUploadAsBranch(page, "망원점");
    const file = xlsxFile([["전화번호"], ["010-0000-7101"], ["010-0000-7102"]]);

    await fileInput(page).setInputFiles(file);
    await page.getByRole("button", { name: "2명 저장" }).click();
    await expect(page.getByText("2명을 저장했어요")).toBeVisible();

    await page.getByRole("button", { name: "다른 파일 올리기" }).click();
    await fileInput(page).setInputFiles(file);
    await expect(card(page, "중복")).toContainText("2");
    await expect(page.getByRole("button", { name: "0명 저장" })).toBeDisabled();
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

    await expect(card(page, "저장할 수 있어요")).toContainText("1");
    await page.getByRole("button", { name: "1명 저장" }).click();
    await expect(page.getByText("1명을 저장했어요")).toBeVisible();

    await page.goto("/contacts?q=01000007201");
    await expect(page.getByRole("table", { name: "연락처" })).toContainText(
      "김",
    );
  });

  test.describe("거부", () => {
    test.beforeEach(async ({ page }) => {
      await openUploadAsBranch(page, "성수점");
    });

    test("머리글이 없으면 안내한다", async ({ page }) => {
      await fileInput(page).setInputFiles(
        xlsxFile([
          ["이름", "주소"],
          ["김", "서울"],
        ]),
      );
      await expect(page.getByRole("alert").first()).toContainText(
        "전화번호 열을 찾지 못했어요",
      );
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

  test("본사는 업로드 화면에 들어갈 수 없다", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
    await expect(page.getByRole("note")).toBeVisible();

    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "엑셀 업로드" })).toHaveCount(
      0,
    );

    await page.goto("/contacts/upload");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
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
    await expect(card(page, "저장할 수 있어요")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __workerState: { terminated: boolean } })
            .__workerState.terminated,
      ),
    ).toBe(true);
  });
});
