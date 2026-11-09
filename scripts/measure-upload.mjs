// 측정 2: 엑셀 1만 행 업로드 중 화면 반응. docs/performance.md의 수치를 만든다.
//
// 준비: npx supabase start → npm run db:seed:large → npm run build → npm run start
// 실행: node scripts/measure-upload.mjs [실행 횟수=3] [행 수=10000] [CPU 저하 배수=1]
//
// 개발 PC는 빠르므로 사무용 PC를 흉내 내는 CPU 저하 조건도 함께 잰다. 저하 배수는 근사값이다.
//
// 읽기(파일 → 미리보기)와 분류(열 매핑 뒤 Worker) 구간에서 각각 입력 지연과 Long Task를 재고,
// 분류 뒤 서버 확인·저장 시간과 전체 처리 시간을 함께 잰다.
// 저장까지 하므로 실행마다 측정 행을 지운다. 그래서 로컬 Supabase가 아니면 시작하지 않는다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
if (
  !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NEXT_PUBLIC_SUPABASE_URL)
) {
  throw new Error("측정 행을 지우는 스크립트라 로컬 Supabase에서만 실행한다");
}
const service = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const NAME_PREFIX = "측정고객";

async function removeMeasuredContacts() {
  const { error } = await service
    .from("contacts")
    .delete()
    .like("name", `${NAME_PREFIX}%`);
  if (error) throw new Error(error.message);
}

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:3000";
const RUNS = Number(process.argv[2] ?? 3);
const ROWS = Number(process.argv[3] ?? 10_000);
const CPU_THROTTLE = Number(process.argv[4] ?? 1);
const CLICK_INTERVAL_MS = 50;

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function createFile(dir) {
  // 실제 번호가 아닌 01000 시험 대역이다. 2만 행도 겹치지 않아야 저장 구간이 전부 재진다.
  const sheet = XLSX.utils.aoa_to_sheet([
    ["전화번호", "이름", "메모"],
    ...Array.from({ length: ROWS }, (_, index) => [
      `010${String(index).padStart(8, "0")}`,
      `${NAME_PREFIX}${index}`,
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

  // 업로드는 주소록의 대화상자다. 읽기 구간은 파일을 고른 뒤 Worker가 표를 읽을 때까지다.
  await page.goto(`${BASE}/contacts`);
  await page.getByRole("button", { name: "엑셀 업로드" }).click();
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

  // 처리하는 동안 대화상자 안을 계속 누른다(바깥을 누르면 닫힌다). 브라우저가 응답할 때까지 요청이 쌓인다.
  // 대화상자 높이가 단계마다 달라 위치를 매번 구한다. 왼쪽 위 여백은 눌러도 아무 동작이 없다.
  const dialog = page.getByRole("dialog");
  const startClicking = () => {
    const run = { active: true, done: Promise.resolve() };
    run.done = (async () => {
      while (run.active) {
        const box = await dialog.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + 16, box.y + 16).catch(() => {});
        }
        await new Promise((resolve) => setTimeout(resolve, CLICK_INTERVAL_MS));
      }
    })();
    return async () => {
      run.active = false;
      await run.done;
    };
  };

  const stopReading = startClicking();
  await page.getByLabel("업로드할 파일").setInputFiles(file);
  await page.waitForFunction(
    () => document.documentElement.dataset.uploadReady,
    undefined,
    { polling: 100, timeout: 300_000 },
  );
  await stopReading();

  // 연타와 겹치면 마우스 누름과 뗌이 섞여 이 클릭이 무시된다. 그래서 잠시 멈췄다가 다시 시작한다.
  await page.getByRole("button", { name: /행 처리 시작/ }).click();
  const stopProcessing = startClicking();
  const summary = page.getByRole("region", { name: "업로드 결과" });
  await summary.waitFor();
  await stopProcessing();
  await page.waitForTimeout(500);
  const summaryText = (await summary.innerText()).replace(/\s+/g, " ");

  const result = await page.evaluate(() => {
    const at = (name) => performance.getEntriesByName(name)[0]?.startTime;
    const state = window.__measure;
    const within = (start, end) => {
      const inRange = (time) => time >= start && time <= end + 50;
      const delays = state.inputDelays
        .filter((entry) => inRange(entry.at))
        .map((entry) => entry.delay);
      const tasks = state.longTasks
        .filter((entry) => inRange(entry.at))
        .map((entry) => entry.duration);
      return {
        samples: delays.length,
        maxInputDelayMs: Math.max(0, ...delays),
        longTaskMaxMs: Math.max(0, ...tasks),
      };
    };
    const parseStart = at("upload:parse-start");
    const parseEnd = at("upload:parse-end");
    const processStart = at("upload:process-start");
    const classifyEnd = at("upload:classify-end");
    const processEnd = at("upload:process-end");
    const read = within(parseStart, parseEnd);
    const classify = within(processStart, classifyEnd);
    return {
      parseMs: parseEnd - parseStart,
      readInputSamples: read.samples,
      readMaxInputDelayMs: read.maxInputDelayMs,
      readLongTaskMaxMs: read.longTaskMaxMs,
      classifyMs: classifyEnd - processStart,
      classifyInputSamples: classify.samples,
      classifyMaxInputDelayMs: classify.maxInputDelayMs,
      classifyLongTaskMaxMs: classify.longTaskMaxMs,
      checkAndSaveMs: processEnd - classifyEnd,
      processMs: processEnd - processStart,
    };
  });

  await browser.close();
  console.error(summaryText);
  return result;
}

const dir = mkdtempSync(join(tmpdir(), "dahda-measure-"));
try {
  const file = createFile(dir);
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    await removeMeasuredContacts();
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
  await removeMeasuredContacts();
  rmSync(dir, { recursive: true, force: true });
}
