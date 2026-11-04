// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/server/auth/to-current-member";

const requireRole =
  vi.fn<(allowed: readonly string[]) => Promise<CurrentMember>>();
const createServerClient = vi.fn();
const rpc = vi.fn();
let campaign: Record<string, unknown> | null;

vi.mock("@/server/auth/requireRole", () => ({ requireRole }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: createServerClient,
}));
vi.mock("@/server/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { approveCampaign, cancelCampaign, rejectCampaign } =
  await import("./approval-actions");

const ID = "5eed0000-0000-4000-8000-000000000011";
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
  vi.useRealTimers();
  requireRole.mockResolvedValue(hq);
  rpc.mockResolvedValue({ error: null });
  campaign = {
    status: "pending_approval",
    is_ad: true,
    scheduled_at: null,
    reviewed_at: null,
  };
  createServerClient.mockImplementation(async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: campaign }),
    };
    return { from: () => chain };
  });
});

describe("권한 가드", () => {
  it.each<[string, readonly string[], () => Promise<unknown>]>([
    ["approveCampaign", ["hq"], () => approveCampaign(ID)],
    ["rejectCampaign", ["hq"], () => rejectCampaign(ID, "사유")],
    ["cancelCampaign", ["hq", "branch"], () => cancelCampaign(ID)],
  ])("%s는 %j만 허용하고 막히면 DB를 부르지 않는다", async (_, roles, run) => {
    requireRole.mockRejectedValue(new Error("REDIRECT:/"));

    await expect(run()).rejects.toThrow("REDIRECT:/");

    expect(requireRole).toHaveBeenCalledWith(roles);
    expect(rpc).not.toHaveBeenCalled();
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("approveCampaign의 야간 판단", () => {
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("낮에 바로 나가는 광고를 승인한다", async () => {
    at("2026-11-04T01:00:00Z"); // KST 10:00
    expect(await approveCampaign(ID)).toBeUndefined();
    expect(rpc).toHaveBeenCalled();
  });

  it("밤에 바로 나가는 광고는 승인하지 않는다", async () => {
    at("2026-11-04T13:00:00Z"); // KST 22:00
    expect((await approveCampaign(ID))?.error).toContain("21:00~08:00");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("밤에 승인해도 낮에 예약된 광고는 통과한다", async () => {
    at("2026-11-04T13:00:00Z"); // KST 22:00
    campaign = { ...campaign, scheduled_at: "2026-11-05T01:00:00Z" }; // 다음 날 10:00
    expect(await approveCampaign(ID)).toBeUndefined();
  });

  it("예약 시각이 지난 광고는 지금 나가는 것으로 본다", async () => {
    at("2026-11-04T13:00:00Z"); // KST 22:00
    campaign = { ...campaign, scheduled_at: "2026-11-04T01:00:00Z" };
    expect((await approveCampaign(ID))?.error).toContain("21:00~08:00");
  });

  it("야간이어도 광고가 아니면 막지 않는다", async () => {
    at("2026-11-04T13:00:00Z");
    campaign = { ...campaign, is_ad: false };
    expect(await approveCampaign(ID)).toBeUndefined();
  });
});

describe("상태 전이", () => {
  it("승인 대기가 아니면 승인·반려하지 않는다", async () => {
    campaign = { ...campaign, status: "scheduled" };
    expect((await approveCampaign(ID))?.error).toBe("이미 처리된 요청이에요");
    expect((await rejectCampaign(ID, "사유"))?.error).toBe(
      "이미 처리된 요청이에요",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("빈 반려 사유 %j를 거부한다", async (reason) => {
    expect((await rejectCampaign(ID, reason))?.error).toBe(
      "반려 사유를 입력해 주세요",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("승인된 예약은 취소하지 않는다", async () => {
    campaign = {
      ...campaign,
      status: "scheduled",
      reviewed_at: "2026-11-04T00:00:00Z",
    };
    expect((await cancelCampaign(ID))?.error).toBe(
      "승인된 문자는 취소할 수 없어요",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("취소할 계정은 입력이 아니라 세션에서 정한다", async () => {
    requireRole.mockResolvedValue({ ...hq, role: "branch", branchId: "b1" });
    campaign = { ...campaign, status: "scheduled" };

    await cancelCampaign(ID);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_branch_id: "b1" });
  });
});
