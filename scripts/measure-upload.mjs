// 측정 2: 엑셀 1만 행 업로드 중 화면 반응. docs/performance.md의 수치를 만든다.
//
// 준비: npx supabase start → npm run db:seed:large → npm run build → npm run start
// 실행: node scripts/measure-upload.mjs [실행 횟수=3] [행 수=10000] [CPU 저하 배수=1]
//
// 개발 PC는 빠르므로 사무용 PC를 흉내 내는 CPU 저하 조건도 함께 잰다. 저하 배수는 근사값이다.
//
// 파싱 구간에서 세 가지를 잰다. 파싱 시간, 타이머가 밀린 최대 시간(메인 스레드가 멈춘 길이),
// 파싱 중 실제 마우스 입력이 처리되기까지 걸린 시간.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:3000";
const RUNS = Number(process.argv[2] ?? 3);
const ROWS = Number(process.argv[3] ?? 10_000);
const CPU_THROTTLE = Number(process.argv[4] ?? 1);
const CLICK_INTERVAL_MS = 50;

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function createFile(dir) {
  // 실제 번호가 아닌 샘플 형식이다. 측정 뒤 저장하지 않으므로 주소록은 그대로다.
  const sheet = XLSX.utils.aoa_to_sheet([
    ["전화번호", "이름", "메모"],
    ...Array.from({ length: ROWS }, (_, index) => [
      `010-0${String(index % 1000).padStart(3, "0")}-${String(index % 10000).padStart(4, "0")}`,
      `고객${index}`,
      index % 10 === 0 ? "주말 배송 선호" : "",
    ]),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "연락처");
  const path = join(dir, `contacts-${ROWS}.xlsx`);
  writeFileSync(path, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  return path;
}

async function measureOnce(file) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(300_000);

  await page.goto(`${BASE}/login`);
  await page.getByLabel("이메일").fill("seed-seongsu@example.com");
  await page.getByLabel("비밀번호").fill("local-seed-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(`${BASE}/`);

  await page.goto(`${BASE}/contacts/upload`);
  await page.getByRole("button", { name: "파일 선택" }).waitFor();

  // 파일 처리 구간에만 적용한다. 로그인과 화면 진입 시간은 재지 않는다.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });

  await page.evaluate(() => {
    const state = { gaps: [], inputDelays: [], longTasks: [] };
    window.__measure = state;
    let last = performance.now();
    window.__tick = setInterval(() => {
      const now = performance.now();
      state.gaps.push({ at: now, gap: now - last - 10 });
      last = now;
    }, 10);
    // 입력이 발생한 시각과 처리되기 시작한 시각의 차이다.
    document.addEventListener(
      "pointerdown",
      (event) => {
        state.inputDelays.push({
          at: event.timeStamp,
          delay: performance.now() - event.timeStamp,
        });
      },
      true,
    );
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({ at: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask" });
  });

  // 파싱하는 동안 화면의 빈 곳을 계속 누른다. 브라우저가 응답할 때까지 요청이 쌓인다.
  let clicking = true;
  const clicker = (async () => {
    while (clicking) {
      await page.mouse.click(20, 780).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, CLICK_INTERVAL_MS));
    }
  })();

  await page.getByLabel("업로드할 파일").setInputFiles(file);
  await page.waitForFunction(
    () => document.documentElement.dataset.uploadReady,
    undefined,
    { polling: 100, timeout: 300_000 },
  );
  clicking = false;
  await clicker;
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const start =
      performance.getEntriesByName("upload:parse-start")[0]?.startTime;
    const end = performance.getEntriesByName("upload:parse-end")[0]?.startTime;
    const inRange = (at) => at >= start && at <= end + 50;
    const state = window.__measure;
    const delays = state.inputDelays
      .filter((entry) => inRange(entry.at))
      .map((entry) => entry.delay);
    const tasks = state.longTasks
      .filter((entry) => inRange(entry.at))
      .map((entry) => entry.duration);
    return {
      parseMs: end - start,
      rows: Number(document.documentElement.dataset.uploadReady),
      inputSamples: delays.length,
      maxInputDelayMs: Math.max(0, ...delays),
      longTaskCount: tasks.length,
      longTaskTotalMs: tasks.reduce((sum, duration) => sum + duration, 0),
      longTaskMaxMs: Math.max(0, ...tasks),
    };
  });

  await browser.close();
  return result;
}

const dir = mkdtempSync(join(tmpdir(), "dahda-measure-"));
try {
  const file = createFile(dir);
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    const result = await measureOnce(file);
    console.error(`run ${index + 1}:`, JSON.stringify(result));
    runs.push(result);
  }
  const summary = Object.fromEntries(
    Object.keys(runs[0]).map((key) => [
      key,
      Math.round(median(runs.map((run) => run[key])) * 10) / 10,
    ]),
  );
  console.log(
    JSON.stringify({
      runs: RUNS,
      rows: ROWS,
      cpu: CPU_THROTTLE,
      median: summary,
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
