// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_GROUPS, SIZE_TOKENS, TYPE_SCALE } from "./design-tokens";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const defined = new Set(
  [...root.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
);

describe("디자인 시스템 토큰 목록", () => {
  const colors = COLOR_GROUPS.flatMap((group) => [...group.tokens]) as string[];

  it("페이지의 모든 토큰이 globals.css에 있다", () => {
    for (const token of [...colors, ...SIZE_TOKENS.map(([name]) => name)]) {
      expect(defined, token).toContain(token);
    }
  });

  it("globals.css의 색을 빠짐없이 보여 준다", () => {
    const sizeNames = new Set<string>(SIZE_TOKENS.map(([name]) => name));
    const missing = [...defined].filter(
      (name): name is string =>
        !!name &&
        !colors.includes(name) &&
        !sizeNames.has(name) &&
        !name.startsWith("--shadow") &&
        name !== "--sheet-w",
    );
    expect(missing).toEqual([]);
  });

  it("글자 크기 클래스가 테마에 있다", () => {
    for (const { name } of TYPE_SCALE) {
      expect(css).toContain(`--text-${name}:`);
    }
  });
});
