/**
 * 측정 5: 발송 내역 화면 Lighthouse (PC). 3회 중앙값.
 * 사용: node scripts/measure-lighthouse.mjs [기준 주소] [화면 경로] [횟수]
 *
 * 로그인 뒤 화면이라 그냥 재면 로그인 화면 점수가 나온다. Playwright로 체험 계정에 들어가 세션 쿠키를 넘긴다.
 * 체험 계정 1개를 만들며 문자를 보내지 않는다. 체험 데이터는 3일 뒤 자동 삭제된다.
 * lighthouse는 앱 의존성에 넣지 않는다. 측정할 때만 쓰므로 npx로 버전을 고정해 부른다.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const LIGHTHOUSE = "lighthouse@13.6.0";
const BASE = process.argv[2] ?? "https://dahda-xi.vercel.app";
const PATH = process.argv[3] ?? "/history";
const RUNS = Number(process.argv[4] ?? 3);

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/login`);
await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
const cookies = await context.cookies(BASE);
await browser.close();

const cookieHeader = cookies
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join("; ");
const dir = mkdtempSync(join(tmpdir(), "dahda-lighthouse-"));
const headersFile = join(dir, "headers.json");
const results = [];

try {
  // 쿠키는 세션 값이라 명령줄에 넣지 않는다. 프로세스 목록과 로그에 남는다.
  writeFileSync(headersFile, JSON.stringify({ Cookie: cookieHeader }));

  for (let run = 0; run < RUNS; run += 1) {
    const output = join(dir, `run-${run}.json`);
    const result = spawnSync(
      "npx",
      [
        "-y",
        LIGHTHOUSE,
        `${BASE}${PATH}`,
        "--preset=desktop",
        "--only-categories=performance,accessibility,best-practices",
        "--output=json",
        `--output-path=${output}`,
        `--extra-headers=${headersFile}`,
        "--chrome-flags=--headless=new --no-sandbox",
        "--quiet",
      ],
      {
        shell: process.platform === "win32",
        encoding: "utf8",
        env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      },
    );
    let report;
    try {
      report = JSON.parse(readFileSync(output, "utf8"));
    } catch {
      console.error((result.stderr ?? "").slice(-800));
      throw new Error(`${run + 1}회차 결과가 없습니다`);
    }
    const score = (name) => Math.round(report.categories[name].score * 100);
    const metric = (name) => Math.round(report.audits[name].numericValue);
    const row = {
      finalUrl: report.finalDisplayedUrl,
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      fcp: metric("first-contentful-paint"),
      lcp: metric("largest-contentful-paint"),
      tbt: metric("total-blocking-time"),
      cls: report.audits["cumulative-layout-shift"].numericValue,
    };
    results.push(row);
    console.log(`${run + 1}회차`, JSON.stringify(row));
    if (run === RUNS - 1) {
      const failed = Object.values(report.audits)
        .filter(
          (audit) =>
            audit.score !== null &&
            audit.score < 0.9 &&
            audit.scoreDisplayMode !== "informative" &&
            audit.scoreDisplayMode !== "notApplicable",
        )
        .map((audit) => `${audit.id}: ${audit.displayValue ?? audit.score}`);
      console.log("개선 후보:", failed.slice(0, 20).join(" | "));
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const summary = {};
for (const key of [
  "performance",
  "accessibility",
  "bestPractices",
  "fcp",
  "lcp",
  "tbt",
  "cls",
]) {
  summary[key] = median(results.map((row) => row[key]));
}
console.log(`중앙값 (${BASE}${PATH}, ${RUNS}회)`, JSON.stringify(summary));
