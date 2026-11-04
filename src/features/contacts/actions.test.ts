// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMember } from "@/server/auth/to-current-member";

const requireRole =
  vi.fn<(allowed: readonly string[]) => Promise<CurrentMember>>();
const createServerClient = vi.fn();

vi.mock("@/server/auth/requireRole", () => ({ requireRole }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: createServerClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("./actions");

const ID = "5eed0000-0000-4000-8000-000000000011";
const contact = { phone: "01000000001", name: "", memo: "", groupIds: [] };
const optOut = { phone: "01000000001", reason: "" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("권한 가드", () => {
  // 가드가 막으면(redirect는 예외를 던진다) DB에 닿기 전에 끝나야 한다.
  it.each<[string, readonly string[], () => Promise<unknown>]>([
    ["createContact", ["branch"], () => actions.createContact(contact)],
    ["updateContact", ["branch"], () => actions.updateContact(ID, contact)],
    ["deleteContact", ["branch"], () => actions.deleteContact(ID)],
    ["createGroup", ["branch"], () => actions.createGroup({ name: "단골" })],
    [
      "renameGroup",
      ["branch"],
      () => actions.renameGroup(ID, { name: "단골" }),
    ],
    ["deleteGroup", ["branch"], () => actions.deleteGroup(ID)],
    ["addOptOut", ["hq", "branch"], () => actions.addOptOut(optOut)],
    ["removeOptOut", ["hq"], () => actions.removeOptOut(ID)],
  ])("%s는 %j만 허용하고 막히면 DB를 부르지 않는다", async (_, roles, run) => {
    requireRole.mockRejectedValue(new Error("REDIRECT:/"));

    await expect(run()).rejects.toThrow("REDIRECT:/");

    expect(requireRole).toHaveBeenCalledWith(roles);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
