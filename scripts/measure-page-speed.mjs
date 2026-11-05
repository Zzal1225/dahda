/**
 * 운영 사이트 화면 응답 시간 측정. 함수 리전을 옮기기 전후를 같은 조건으로 비교하려고 만들었다.
 * 사용: node scripts/measure-page-speed.mjs [기준 주소] [반복 횟수]
 *
 * 체험 계정 1개로 측정한다. 실제 계정을 쓰지 않으며 문자를 보내지 않는다. 체험 데이터는 3일 뒤 자동 삭제된다.
 *
 * TTFB를 쓰지 않는다. Cache Components는 정적 껍데기를 먼저 보내므로 TTFB가 13ms로 나오지만 그때 화면에는
 * 데이터가 없다. 그래서 요청 시작부터 응답 스트림이 끝날 때까지를 잰다.
 * - 새로고침: 문서 요청이 끝날 때까지
 * - 메뉴 클릭: 클릭부터 그 화면의 RSC 요청이 끝나거나 라우터가 취소할 때까지. 미리 받아 둔 응답(prefetch)은 요청이 없을 수 있어 그때는 URL 변경까지.
 * 첫 회차는 콜드 스타트가 섞일 수 있어 목록에만 두고 중앙값에서는 뺀다.
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://dahda-xi.vercel.app";
const ROUNDS = Number(process.argv[3] ?? 6);
const PAGES = [
  ["/", "홈"],
  ["/contacts", "주소록"],
  ["/compose", "문자 작성"],
  ["/history", "발송 내역"],
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// finished()와 response()에는 제한 시간이 없다. 전환으로 취소된 요청을 기다리면 끝나지 않으므로 직접 끊는다.
const WAIT_LIMIT_MS = 20_000;
let timedOut = 0;
const limited = (promise) => {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut += 1;
      resolve(null);
    }, WAIT_LIMIT_MS);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

await page.goto(`${BASE}/login`);
await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

const reloads = new Map(PAGES.map(([path]) => [path, []]));
const clicks = new Map(PAGES.map(([path]) => [path, []]));
let region = "";

async function clickMenu(path, label) {
  // 라우터가 응답을 받은 뒤 요청을 취소(ERR_ABORTED)하기도 한다. finished()는 그때 끝나지 않으므로
  // 완료와 취소 이벤트를 모두 요청의 끝으로 본다. 동기 헤더를 쓴다. 비동기로 읽으면 요청을 놓친다.
  const pending = new Set();
  let lastEnd = 0;
  const isTarget = (request) => {
    const headers = request.headers();
    return (
      new URL(request.url()).pathname === path &&
      headers.rsc &&
      !headers["next-router-prefetch"]
    );
  };
  const onRequest = (request) => {
    if (isTarget(request)) pending.add(request);
  };
  const onEnd = (request) => {
    if (pending.delete(request)) lastEnd = performance.now();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onEnd);
  page.on("requestfailed", onEnd);
  const started = performance.now();
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
  await page.waitForTimeout(100);
  const limit = performance.now() + WAIT_LIMIT_MS;
  while (pending.size > 0 && performance.now() < limit) {
    await page.waitForTimeout(20);
  }
  if (pending.size > 0) timedOut += 1;
  const elapsed = (lastEnd || performance.now()) - started;
  page.off("request", onRequest);
  page.off("requestfinished", onEnd);
  page.off("requestfailed", onEnd);
  // prefetch가 끝나 다음 측정에 섞이지 않게 기다린다. 측정값에는 포함하지 않는다.
  await page.waitForTimeout(2500);
  return Math.round(elapsed);
}

for (let round = 0; round < ROUNDS; round += 1) {
  for (const [path] of PAGES) {
    const started = performance.now();
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
    await limited(response?.finished());
    reloads.get(path).push(Math.round(performance.now() - started));
    region = (await response?.headerValue("x-vercel-id")) ?? region;
    await page.waitForTimeout(500);
  }
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  for (const [path, label] of [...PAGES.slice(1), PAGES[0]]) {
    clicks.get(path).push(await clickMenu(path, label));
  }
}

console.log(
  `기준: ${BASE}, 회차: ${ROUNDS}, 마지막 x-vercel-id: ${region}, 제한 시간 초과: ${timedOut}건`,
);
for (const [path, label] of PAGES) {
  const reload = reloads.get(path);
  const click = clicks.get(path);
  console.log(
    `${label} (${path}) | 새로고침 중앙값 ${median(reload.slice(1))}ms [${reload.join(", ")}] | 메뉴 클릭 중앙값 ${median(click.slice(1))}ms [${click.join(", ")}]`,
  );
}
await browser.close();
