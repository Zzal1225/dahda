import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // CLAUDE.md 규칙. 프리셋 기본값에 기대지 않고 명시해, 프리셋이 바뀌어도 규칙이 유지되게 한다.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 디자인 핸드오프는 참고 자료이고 런타임 코드가 아니다. 린트 대상이면 생성 코드(support.js)까지 걸린다.
    "design/**",
    "private/**",
  ]),
]);

export default eslintConfig;
