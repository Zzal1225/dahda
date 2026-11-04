// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember, MemberRole } from "./to-current-member";

/**
 * requireRole.ts는 사용자가 직접 작성한다(CLAUDE.md 5-1). 이 테스트는 그 파일의 계약이다.
 * 파일이 생기기 전에는 건너뛰어 CI를 깨지 않고, 파일이 생기면 자동으로 돌아간다.
 */
const implementation = resolve(process.cwd(), "src/server/auth/requireRole.ts");

const getCurrentMember = vi.fn<() => Promise<CurrentMember | null>>();
const redirect = vi.fn((path: string): never => {
  // 실제 redirect도 예외로 흐름을 끊는다. 여기서 던지지 않으면 "return 빠뜨림" 버그를 잡을 수 없다.
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("./current-member", () => ({ getCurrentMember }));
vi.mock("next/navigation", () => ({ redirect }));

const hq: CurrentMember = {
  userId: "u1",
  orgId: "o1",
  orgName: "본사",
  branchId: null,
  branchName: null,
  role: "hq",
  displayName: "본사 담당",
  isTrial: false,
};
const branch: CurrentMember = {
  ...hq,
  userId: "u2",
  role: "branch",
  branchId: "b1",
  branchName: "성수점",
};

describe.skipIf(!existsSync(implementation))("requireRole", () => {
  async function load() {
    const loaded = (await import(/* @vite-ignore */ implementation)) as {
      requireRole: (allowed: readonly MemberRole[]) => Promise<CurrentMember>;
    };
    return loaded.requireRole;
  }

  beforeEach(() => {
    getCurrentMember.mockReset();
    redirect.mockClear();
  });

  it("허용된 역할이면 구성원을 그대로 돌려준다", async () => {
    getCurrentMember.mockResolvedValue(hq);
    const requireRole = await load();

    await expect(requireRole(["hq"])).resolves.toBe(hq);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("여러 역할 중 하나면 통과한다", async () => {
    getCurrentMember.mockResolvedValue(branch);
    const requireRole = await load();

    await expect(requireRole(["hq", "branch"])).resolves.toBe(branch);
  });

  it("로그인하지 않았으면 로그인 화면으로 보낸다", async () => {
    getCurrentMember.mockResolvedValue(null);
    const requireRole = await load();

    await expect(requireRole(["hq"])).rejects.toThrow("REDIRECT:/login");
  });

  it("역할이 맞지 않으면 홈으로 보낸다", async () => {
    getCurrentMember.mockResolvedValue(branch);
    const requireRole = await load();

    await expect(requireRole(["hq"])).rejects.toThrow("REDIRECT:/");
  });

  it("지점 전용 동작에 본사도 막는다", async () => {
    getCurrentMember.mockResolvedValue(hq);
    const requireRole = await load();

    await expect(requireRole(["branch"])).rejects.toThrow("REDIRECT:/");
  });

  it("허용 목록이 비어 있으면 아무도 통과하지 못한다", async () => {
    // 목록을 잘못 넘겼을 때 전부 허용되는 쪽이 아니라 전부 막히는 쪽으로 실패해야 한다.
    getCurrentMember.mockResolvedValue(hq);
    const requireRole = await load();

    await expect(requireRole([])).rejects.toThrow("REDIRECT:/");
  });
});
