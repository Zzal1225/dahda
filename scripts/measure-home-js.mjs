// 첫 화면("/")의 JS 전송 크기(압축). load 이벤트까지 받은 것과 networkidle까지 전체를 나눠 센다.
// docs/performance.md "첫 화면 JS와 차트 라이브러리"의 수치를 만든다.
// 실행: npm run build → npm run start -- --port <포트> → node scripts/measure-home-js.mjs <포트>
// 로그인 화면에서 받은 스크립트가 캐시에 남으면 0KB로 나와서 캐시를 끄고 잰다.
import { chromium } from "@playwright/test";
const port = process.argv[2];
const b = await chromium.launch();
const p = await (
  await b.newContext({ viewport: { width: 1440, height: 1000 } })
).newPage();
await p.goto(`http://127.0.0.1:${port}/login`);
await p.getByRole("button", { name: "로그인 없이 체험하기" }).click();
await p.getByRole("note").waitFor();
const cdp = await p.context().newCDPSession(p);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Page.enable");
const scripts = new Map();
let loadAt = Infinity;
cdp.on("Page.loadEventFired", (e) => {
  loadAt = e.timestamp;
});
cdp.on("Network.responseReceived", (e) => {
  if (e.type === "Script") scripts.set(e.requestId, { size: 0, at: 0 });
});
cdp.on("Network.loadingFinished", (e) => {
  const s = scripts.get(e.requestId);
  if (s) {
    s.size = e.encodedDataLength;
    s.at = e.timestamp;
  }
});
await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const all = [...scripts.values()];
const kb = (list) => Math.round(list.reduce((t, s) => t + s.size, 0) / 1024);
console.log(
  JSON.stringify({
    beforeLoadKB: kb(all.filter((s) => s.at <= loadAt)),
    totalKB: kb(all),
    scripts: all.length,
  }),
);
await b.close();
