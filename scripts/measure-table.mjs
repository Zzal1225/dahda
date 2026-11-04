// 측정 1: 10만 행 발송 내역 표. docs/performance.md의 수치를 만든다.
//
// 준비: npx supabase start → npm run db:seed:large → npm run build → npm run start
// 실행: node scripts/measure-table.mjs [실행 횟수, 기본 3]
//
// 화면이 table:* 표시를 남기면 그것을 읽고, 스크롤 중 프레임 간격과 Long Task를 브라우저 안에서 잰다.
import { chromium } from "@playwright/test";

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:3000";
const RUNS = Number(process.argv[2] ?? 3);
const CAMPAIGN = "5eed0000-0000-4000-8000-000000000021";
const SCROLL_MS = 5000;

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measureOnce() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(600_000);

  await page.goto(`${BASE}/login`);
  await page.getByLabel("이메일").fill("seed-hq@example.com");
  await page.getByLabel("비밀번호").fill("local-seed-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(`${BASE}/`);

  // 화면이 시작되기 전에 Long Task 관찰을 건다.
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });

  const started = Date.now();
  await page.goto(`${BASE}/history?campaign=${CAMPAIGN}`);
  await page.waitForFunction(
    () => document.documentElement.dataset.tableReady,
    undefined,
    { timeout: 600_000, polling: 200 },
  );
  const wallMs = Date.now() - started;

  const marks = await page.evaluate(() => {
    const at = (name) =>
      performance.getEntriesByName(name)[0]?.startTime ?? null;
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    return {
      fetchStart: at("table:fetch-start"),
      fetchEnd: at("table:fetch-end"),
      painted: at("table:painted"),
      rowCount: Number(document.documentElement.dataset.tableReady),
      domRows: document.querySelectorAll("tbody tr, [data-row]").length,
      domNodes: document.getElementsByTagName("*").length,
      longTaskCount: window.__longTasks.length,
      longTaskTotalMs: sum(window.__longTasks),
      longTaskMaxMs: Math.max(0, ...window.__longTasks),
      heapMb: performance.memory
        ? performance.memory.usedJSHeapSize / 1024 / 1024
        : null,
    };
  });

  // 위에서 아래까지 일정 속도로 스크롤하며 프레임 간격을 모은다.
  const scroll = await page.evaluate(
    (durationMs) =>
      new Promise((resolve) => {
        const scroller =
          document.querySelector("[data-table-scroller]") ??
          document.scrollingElement;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const frames = [];
        const start = performance.now();
        let last = start;
        function tick(now) {
          frames.push(now - last);
          last = now;
          const progress = Math.min(1, (now - start) / durationMs);
          scroller.scrollTop = max * progress;
          if (progress < 1) requestAnimationFrame(tick);
          else {
            const body = frames.slice(1);
            resolve({
              frames: body.length,
              fps: body.length / (durationMs / 1000),
              worstFrameMs: Math.max(...body),
              over50ms: body.filter((frame) => frame > 50).length,
            });
          }
        }
        requestAnimationFrame(tick);
      }),
    SCROLL_MS,
  );

  await browser.close();
  return {
    wallMs,
    fetchMs: marks.fetchEnd - marks.fetchStart,
    renderMs: marks.painted - marks.fetchEnd,
    rowCount: marks.rowCount,
    domRows: marks.domRows,
    domNodes: marks.domNodes,
    longTaskCount: marks.longTaskCount,
    longTaskTotalMs: marks.longTaskTotalMs,
    longTaskMaxMs: marks.longTaskMaxMs,
    heapMb: marks.heapMb,
    fps: scroll.fps,
    worstFrameMs: scroll.worstFrameMs,
    framesOver50ms: scroll.over50ms,
  };
}

const runs = [];
for (let index = 0; index < RUNS; index += 1) {
  const result = await measureOnce();
  console.error(`run ${index + 1}:`, JSON.stringify(result));
  runs.push(result);
}

const summary = Object.fromEntries(
  Object.keys(runs[0]).map((key) => [
    key,
    Math.round(median(runs.map((run) => run[key])) * 10) / 10,
  ]),
);
console.log(JSON.stringify({ runs: RUNS, median: summary }, null, 2));
