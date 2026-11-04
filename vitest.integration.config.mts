import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 키를 .env에 복사하지 않고 실행 중인 로컬 Supabase에서 읽는다.
 * 복사본은 `supabase start`가 키를 바꾸면 조용히 어긋나고, 이 명령은 CI에서도 같게 동작한다.
 */
function readLocalSupabase(): Record<string, string> {
  try {
    const stdout = execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(stdout) as Record<string, string>;
  } catch (cause) {
    throw new Error(
      "로컬 Supabase가 꺼져 있다. `npx supabase start`를 먼저 실행한다.",
      { cause },
    );
  }
}

const local = readLocalSupabase();

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // 파일을 동시에 돌리면 로그인 횟수 제한에 걸리고, 실패했을 때 어느 파일의 데이터인지 가리기 어렵다.
    // 각 파일은 자기 본사만 쓰므로 순서에는 의존하지 않는다.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      SUPABASE_URL: local.API_URL ?? "",
      SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? "",
      SUPABASE_SECRET_KEY: local.SECRET_KEY ?? "",
    },
  },
});
