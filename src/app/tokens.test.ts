import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 디자인 토큰을 손으로 옮기면 오타나 누락을 눈으로 찾기 어렵다.
 * 파일을 읽어 비교하는 이유: 기대값을 테스트에 또 적으면 원본이 셋이 되고, 원본이 바뀌어도 테스트가 통과한다.
 */
const designFile = resolve(
  process.cwd(),
  "design/design_handoff_dahda_console/0 디자인 시스템.dc.html",
);
const cssFile = resolve(process.cwd(), "src/app/globals.css");

/** 대소문자·공백·0.48/.48 표기 차이는 값이 같으므로 비교에서 무시한다. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(^|[(,])0?\.(\d)/g, "$1.$2");
}

function readRootVars(source: string): Map<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(source)?.[1];
  if (!root) throw new Error(":root 블록을 찾지 못했다");

  const withoutComments = root.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = new Map<string, string>();
  for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) vars.set(name, normalize(value));
  }
  return vars;
}

// 핸드오프에 실제 형식의 샘플 번호가 있어 design/은 저장소에 올리지 않는다.
// 그래서 원본이 있는 로컬에서만 비교하고, CI에서는 건너뛴다. 토큰을 고칠 때는 로컬에서 이 테스트를 돌린다.
describe.skipIf(!existsSync(designFile))("디자인 토큰", () => {
  const design = readRootVars(readFileSync(designFile, "utf8"));
  const css = readRootVars(readFileSync(cssFile, "utf8"));

  // 글꼴·간격·둥글기는 Tailwind의 @theme과 기본 간격 단위로 옮겨 이름이 달라지므로 값 토큰만 1:1로 본다.
  const copiedAsIs = [...design.keys()].filter(
    (name) => !/^--(font|t-|space-|radius-)/.test(name),
  );

  it("검사 대상이 비어 있지 않다", () => {
    // :root 정규식이 깨지면 아래 테스트가 0건으로 통과하므로 따로 막는다.
    expect(copiedAsIs.length).toBeGreaterThan(30);
  });

  it.each(copiedAsIs)("%s 값이 핸드오프 원본과 같다", (name) => {
    expect(css.get(name)).toBe(design.get(name));
  });
});
