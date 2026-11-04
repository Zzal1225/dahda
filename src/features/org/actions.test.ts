// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/server/auth/to-current-member";

const requireRole =
  vi.fn<(allowed: readonly string[]) => Promise<CurrentMember>>();
const createServerClient = vi.fn();
const createAdminClient = vi.fn();
const createBranchAccount = vi.fn();

vi.mock("@/server/auth/requireRole", () => ({ requireRole }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: createServerClient,
}));
vi.mock("@/server/supabase/admin", () => ({
  createSupabaseAdminClient: createAdminClient,
}));
vi.mock("./branch-account", () => ({ createBranchAccount }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { assignBranchAccount, createBranch, renameBranch } =
  await import("./actions");

const BRANCH_ID = "5eed0000-0000-4000-8000-000000000011";
const account = { displayName: "담당", email: "a@b.co", password: "12345678" };
const hq: CurrentMember = {
  userId: "u",
  orgId: "o",
  orgName: "본사",
  branchId: null,
  branchName: null,
  role: "hq",
  displayName: "본사",
  isTrial: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue(hq);
});

describe("권한 가드", () => {
  // 가드가 막으면(redirect는 예외를 던진다) DB에 닿기 전에 끝나야 한다.
  const cases = [
    ["createBranch", () => createBranch({ name: "새 지점" })],
    ["renameBranch", () => renameBranch(BRANCH_ID, { name: "새 이름" })],
    ["assignBranchAccount", () => assignBranchAccount(BRANCH_ID, account)],
  ] as const;

  it.each(cases)(
    "%s는 본사만 허용하고 막히면 DB를 부르지 않는다",
    async (_, run) => {
      requireRole.mockRejectedValue(new Error("REDIRECT:/"));

      await expect(run()).rejects.toThrow("REDIRECT:/");

      expect(requireRole).toHaveBeenCalledWith(["hq"]);
      expect(createServerClient).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(createBranchAccount).not.toHaveBeenCalled();
    },
  );
});

describe("assignBranchAccount", () => {
  it("체험 계정은 실제 계정을 만들 수 없다", async () => {
    requireRole.mockResolvedValue({ ...hq, isTrial: true });

    const result = await assignBranchAccount(BRANCH_ID, account);

    expect(result).toEqual({ error: "체험 계정에서는 계정을 만들 수 없어요" });
    expect(createBranchAccount).not.toHaveBeenCalled();
  });

  it("지점이 어느 본사 소속인지는 입력이 아니라 세션에서 정한다", async () => {
    createBranchAccount.mockResolvedValue(null);

    await assignBranchAccount(BRANCH_ID, account);

    expect(createBranchAccount.mock.calls[0]?.[1]).toBe("o");
  });

  it("id 형식이 틀리면 만들지 않는다", async () => {
    const result = await assignBranchAccount("not-uuid", account);

    expect(result).toEqual({ error: "입력한 내용을 확인해 주세요" });
    expect(createBranchAccount).not.toHaveBeenCalled();
  });
});
