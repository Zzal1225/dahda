// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/server/auth/to-current-member";

const requireRole =
  vi.fn<(allowed: readonly string[]) => Promise<CurrentMember>>();
const rpc = vi.fn();
let source: Record<string, unknown> | null;

vi.mock("@/server/auth/requireRole", () => ({ requireRole }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: source }),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/server/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { previewRetry, retryFailedMessages } = await import("./retry-actions");

const ID = "5eed0000-0000-4000-8000-000000000011";
const member: CurrentMember = {
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
  vi.useRealTimers();
  requireRole.mockResolvedValue(member);
  source = { id: ID, is_ad: false };
  rpc.mockResolvedValue({ data: "new-id", error: null });
});

describe("권한", () => {
  it.each([
    ["previewRetry", () => previewRetry(ID, [1])],
    ["retryFailedMessages", () => retryFailedMessages(ID, [1])],
  ])("%s는 막히면 DB를 부르지 않는다", async (_, run) => {
    requireRole.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(run()).rejects.toThrow("REDIRECT:/");
    expect(requireRole).toHaveBeenCalledWith(["hq", "branch"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("읽을 수 없는 발송 건은 다시 보내지 않는다", async () => {
    source = null;
    expect(await retryFailedMessages(ID, [1])).toEqual({
      error: "발송 건을 찾지 못했어요",
    });
    expect(await previewRetry(ID, [1])).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("본사 id는 입력이 아니라 세션에서 정한다", async () => {
    await retryFailedMessages(ID, [1]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_org_id: "o",
      p_created_by: "u",
    });
  });
});

describe("입력", () => {
  it.each([
    ["선택 없음", ID, []],
    ["잘못된 발송 건", "abc", [1]],
    ["숫자가 아닌 행", ID, ["1"]],
  ])("%s는 거부한다", async (_, id, ids) => {
    expect(await retryFailedMessages(id, ids)).toEqual({
      error: "다시 보낼 건을 선택해 주세요",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("야간 광고", () => {
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("밤에는 광고를 다시 보내지 않는다", async () => {
    at("2026-11-04T13:00:00Z"); // KST 22:00
    source = { id: ID, is_ad: true };
    const result = await retryFailedMessages(ID, [1]);
    expect(result).toMatchObject({
      error: expect.stringContaining("21:00~08:00"),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("낮이면 보낸다", async () => {
    at("2026-11-04T03:00:00Z"); // KST 12:00
    source = { id: ID, is_ad: true };
    expect(await retryFailedMessages(ID, [1])).toEqual({
      campaignId: "new-id",
    });
  });

  it("광고가 아니면 밤에도 보낸다", async () => {
    at("2026-11-04T13:00:00Z");
    expect(await retryFailedMessages(ID, [1])).toEqual({
      campaignId: "new-id",
    });
  });
});

describe("오류 문구", () => {
  it.each([
    ["DH004", "잔액이 부족해요. 충전한 뒤 다시 보내 주세요"],
    ["DH008", "다시 보낼 수 있는 건이 없어요"],
    ["DH013", "다시 보낼 수 없는 상태예요"],
    ["XX000", "다시 보내지 못했어요"],
  ])("%s", async (code, message) => {
    rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await retryFailedMessages(ID, [1])).toEqual({ error: message });
  });
});

describe("previewRetry", () => {
  it("금액을 계산한다", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          failed_count: 3,
          target_count: 2,
          hopeless_count: 1,
          unit_price: 20,
          kind: "sms",
          balance: 100,
        },
      ],
      error: null,
    });
    expect(await previewRetry(ID, [1, 2, 3])).toEqual({
      failed: 3,
      target: 2,
      hopeless: 1,
      unitPrice: 20,
      kind: "sms",
      amount: 40,
      balance: 100,
    });
  });
});
