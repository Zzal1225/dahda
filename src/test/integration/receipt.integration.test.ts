import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import { must, service } from "./fixture";

// campaign_receipt가 체험 샘플에서 단계별 건수를 맞게 나누는지, RLS 범위를 지키는지 확인한다.
// 단계 상태(끝남·진행 중) 판단은 delivery-receipt.test.ts가 맡고, 여기서는 DB가 주는 숫자만 본다.

const PASSWORD = "local-integration-test";
const options = { auth: { persistSession: false, autoRefreshToken: false } };

let userId = "";
let orgId = "";
let client: SupabaseClient<Database>;

beforeAll(async () => {
  const email = `receipt-${randomUUID()}@example.com`;
  const created = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "사용자 생성 실패");
  }
  userId = created.data.user.id;
  orgId = must(await service.rpc("create_trial_org", { p_user_id: userId }));

  client = createClient<Database>(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    options,
  );
  const signedIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signedIn.error) throw new Error(signedIn.error.message);
});

afterAll(async () => {
  await service.from("organizations").delete().eq("id", orgId);
  await service.auth.admin.deleteUser(userId);
});

async function campaignOf(branchName: string | null, recipients: number) {
  const branchId =
    branchName === null
      ? null
      : must(
          await service
            .from("branches")
            .select("id")
            .eq("org_id", orgId)
            .eq("name", branchName)
            .single(),
        ).id;
  const query = service
    .from("campaigns")
    .select("id")
    .eq("org_id", orgId)
    .eq("recipient_count", recipients);
  return must(
    await (
      branchId === null
        ? query.is("branch_id", null)
        : query.eq("branch_id", branchId)
    ).single(),
  ).id;
}

const receipt = async (campaignId: string) =>
  must(await client.rpc("campaign_receipt", { p_campaign_id: campaignId }));

describe("campaign_receipt", () => {
  it("진행 중인 건을 상태별로 나누고 웹훅 기록을 센다", async () => {
    const [row] = await receipt(await campaignOf(null, 1240));
    expect(row).toMatchObject({
      queued: 0,
      awaiting: 329,
      delivered: 893,
      carrier_failed: 18,
      vendor_failed: 0,
      completed_at: null,
    });
    // 확정된 911건마다 결과 웹훅이 하나씩 있고, 샘플은 그중 일부에 중복을 섞었다.
    expect(row?.webhook_count).toBeGreaterThan(911);
    expect(row?.webhook_ignored).toBe((row?.webhook_count ?? 0) - 911);
    expect(row?.accepted_late).toBeGreaterThan(0);
  });

  it("첫 건 시각은 접수 → 발송 → 통신사 전달 → 도착 순서를 거스르지 않는다", async () => {
    const [row] = await receipt(await campaignOf(null, 1240));
    const times = [
      row?.started_at,
      row?.first_accepted_at,
      row?.first_result_at,
      row?.first_delivered_at,
    ].map((value) => Date.parse(value ?? ""));
    expect(times.every((value) => !Number.isNaN(value))).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("모두 도착한 건은 확정 시각이 있다", async () => {
    const [row] = await receipt(await campaignOf("성수점", 30));
    expect(row).toMatchObject({
      delivered: 30,
      awaiting: 0,
      carrier_failed: 0,
    });
    expect(row?.completed_at).not.toBeNull();
  });

  it("다른 지점 담당자에게는 행이 없다", async () => {
    const seongsu = await campaignOf("성수점", 30);
    const mangwon = must(
      await service
        .from("branches")
        .select("id")
        .eq("org_id", orgId)
        .eq("name", "망원점")
        .single(),
    ).id;
    // 반환값이 없는 함수라 must()를 쓰지 않고 오류만 본다.
    const switched = await service.rpc("switch_trial_role", {
      p_user_id: userId,
      p_branch_id: mangwon,
    });
    expect(switched.error).toBeNull();
    try {
      expect(await receipt(seongsu)).toEqual([]);
    } finally {
      await service.rpc("switch_trial_role", {
        p_user_id: userId,
        // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 역할은 null이다.
        p_branch_id: null as unknown as string,
      });
    }
  });

  it("로그인하지 않으면 부를 수 없다", async () => {
    const anon = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      options,
    );
    const { error } = await anon.rpc("campaign_receipt", {
      p_campaign_id: randomUUID(),
    });
    expect(error?.code).toBe("42501");
  });
});
