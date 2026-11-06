import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

const NOT_TRIAL = "DH005";
const BRANCH_NOT_IN_ORG = "DH006";
const DENIED = "42501";

let f: Fixture;
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await f.cleanup();
  await Promise.all(
    createdUsers.map((id) => service.auth.admin.deleteUser(id)),
  );
});

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const PASSWORD = "local-integration-test";

/** 익명 로그인에는 시간당 횟수 제한이 있어 테스트는 일반 사용자로 만든다. 함수는 사용자 종류를 보지 않는다. */
async function createTrialUser() {
  const email = `trial-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(error?.message ?? "사용자 생성 실패");
  createdUsers.push(data.user.id);

  const orgId = must(
    await service.rpc("create_trial_org", { p_user_id: data.user.id }),
  );
  createdOrgs.push(orgId);
  return { userId: data.user.id, email, orgId };
}

async function branchesOf(orgId: string) {
  return must(
    await service.from("branches").select("id, name").eq("org_id", orgId),
  );
}

function switchRole(userId: string, branchId: string | null) {
  return service.rpc("switch_trial_role", {
    p_user_id: userId,
    // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 역할은 null이다.
    p_branch_id: branchId as string,
  });
}

describe("create_trial_org", () => {
  it("본사 역할로 샘플 본사를 만든다", async () => {
    const { userId, orgId } = await createTrialUser();

    const member = must(
      await service
        .from("members")
        .select("org_id, branch_id, role")
        .eq("user_id", userId)
        .single(),
    );
    const org = must(
      await service
        .from("organizations")
        .select("trial_expires_at")
        .eq("id", orgId)
        .single(),
    );

    expect(member).toEqual({ org_id: orgId, branch_id: null, role: "hq" });
    expect(org.trial_expires_at).not.toBeNull();
  });

  it("지점 3개와 계정별 대표 발신번호를 만든다", async () => {
    const { orgId } = await createTrialUser();

    const branches = await branchesOf(orgId);
    const numbers = must(
      await service
        .from("sender_numbers")
        .select("number, is_default")
        .eq("org_id", orgId),
    );

    expect(branches.map((b) => b.name).sort()).toEqual([
      "망원점",
      "성수점",
      "합정점",
    ]);
    expect(numbers).toHaveLength(4);
    expect(numbers.every((n) => n.is_default)).toBe(true);
    // 실제 번호로 문자가 나가거나 노출되는 일이 없도록 샘플 형식만 쓴다.
    expect(numbers.every((n) => n.number?.startsWith("0100000"))).toBe(true);
  });

  it("잔액을 숫자가 아니라 거래 기록으로 만든다", async () => {
    const { orgId } = await createTrialUser();

    const branches = await branchesOf(orgId);
    const balances = must(
      await service
        .from("account_balances")
        .select("branch_id, balance")
        .eq("org_id", orgId),
    );
    const byName = new Map(branches.map((b) => [b.id, b.name]));

    expect(
      Object.fromEntries(
        balances.map((b) => [
          b.branch_id ? byName.get(b.branch_id) : "본사",
          b.balance,
        ]),
      ),
    ).toEqual({
      본사: 8500000,
      성수점: 2000000,
      망원점: 1310400,
      합정점: 864200,
    });
  });

  it("승인 대기·예약·반려 샘플을 실제 함수와 같은 모양으로 만든다", async () => {
    const { orgId } = await createTrialUser();
    const branches = new Map(
      (await branchesOf(orgId)).map((b) => [b.id, b.name]),
    );
    const campaigns = must(
      await service
        .from("campaigns")
        .select(
          "id, branch_id, status, is_ad, scheduled_at, rejected_reason, messages(count), ledger_entries(kind)",
        )
        .eq("org_id", orgId)
        .in("status", ["pending_approval", "scheduled", "rejected"]),
    );
    const view = Object.fromEntries(
      campaigns.map((c) => [
        c.status,
        {
          branch: c.branch_id ? branches.get(c.branch_id) : "본사",
          messages: c.messages[0]?.count,
          ledger: c.ledger_entries.map((e) => e.kind),
        },
      ]),
    );

    expect(view).toEqual({
      // 승인 전에는 차감하지 않는다.
      pending_approval: { branch: "성수점", messages: 30, ledger: [] },
      scheduled: { branch: "합정점", messages: 30, ledger: ["reserve"] },
      // 반려하면 메시지를 지운다.
      rejected: { branch: "망원점", messages: 0, ledger: [] },
    });
    const scheduled = campaigns.find((c) => c.status === "scheduled");
    expect(new Date(scheduled?.scheduled_at ?? 0).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(
      campaigns.find((c) => c.status === "rejected")?.rejected_reason,
    ).toBeTruthy();
  });

  it("보낸 샘플 메시지에만 기록이 있고 중복·순서 바뀜이 섞여 있다", async () => {
    const { orgId } = await createTrialUser();
    // 기록이 1천 줄을 넘어 API 기본 상한에 잘리므로 행을 받지 않고 센다.
    const count = async (outcome: string) =>
      (
        await service
          .from("message_events")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("outcome", outcome)
      ).count;

    expect(await count("ignored_final")).toBeGreaterThan(0);
    expect(await count("recorded_late")).toBeGreaterThan(0);
    // 승인 대기·예약 샘플은 아직 보내지 않았으므로 기록이 없다.
    const queued = await service
      .from("message_events")
      .select("id, messages!inner(status)", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("messages.status", "queued");
    expect(queued.count).toBe(0);
  });

  it("두 번 불러도 본사가 하나만 생긴다", async () => {
    const { userId, orgId } = await createTrialUser();

    const again = must(
      await service.rpc("create_trial_org", { p_user_id: userId }),
    );

    expect(again).toBe(orgId);
  });

  it("체험 사용자끼리 본사를 공유하지 않는다", async () => {
    const first = await createTrialUser();
    const second = await createTrialUser();

    expect(first.orgId).not.toBe(second.orgId);
  });
});

describe("switch_trial_role", () => {
  it("지점으로 바꾸면 RLS 범위도 바뀌고 본사로 돌아올 수 있다", async () => {
    const { userId, email, orgId } = await createTrialUser();
    const client = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      clientOptions,
    );
    const signedIn = await client.auth.signInWithPassword({
      email: email,
      password: PASSWORD,
    });
    expect(signedIn.error).toBeNull();
    const seongsu = (await branchesOf(orgId)).find((b) => b.name === "성수점");

    const asHq = must(await client.from("branches").select("id"));
    expect(asHq).toHaveLength(3);

    expect((await switchRole(userId, seongsu?.id ?? null)).error).toBeNull();
    const asBranch = must(await client.from("branches").select("id"));
    expect(asBranch.map((b) => b.id)).toEqual([seongsu?.id]);

    expect((await switchRole(userId, null)).error).toBeNull();
    expect(must(await client.from("branches").select("id"))).toHaveLength(3);
  });

  it("실제 본사의 구성원은 바꿀 수 없다", async () => {
    const { error } = await switchRole(f.users.branch1.id, null);

    expect(error?.code).toBe(NOT_TRIAL);
    const member = must(
      await service
        .from("members")
        .select("role")
        .eq("user_id", f.users.branch1.id)
        .single(),
    );
    expect(member.role).toBe("branch");
  });

  it("소속이 없는 사용자는 바꿀 수 없다", async () => {
    const { error } = await switchRole(f.users.outsider.id, null);
    expect(error?.code).toBe(NOT_TRIAL);
  });

  it("다른 본사의 지점으로 바꿀 수 없다", async () => {
    const { userId } = await createTrialUser();
    const { error } = await switchRole(userId, f.branch1);
    expect(error?.code).toBe(BRANCH_NOT_IN_ORG);
  });
});

describe("delete_expired_trials", () => {
  it("만료된 체험 본사와 사용자만 지운다", async () => {
    const expired = await createTrialUser();
    const active = await createTrialUser();
    must(
      await service
        .from("organizations")
        .update({ trial_expires_at: "2020-01-01T00:00:00Z" })
        .eq("id", expired.orgId)
        .select("id"),
    );

    const deleted = must(await service.rpc("delete_expired_trials"));
    expect(deleted).toBeGreaterThanOrEqual(1);

    const orgs = must(
      await service
        .from("organizations")
        .select("id")
        .in("id", [expired.orgId, active.orgId]),
    );
    expect(orgs.map((o) => o.id)).toEqual([active.orgId]);

    const removed = await service.auth.admin.getUserById(expired.userId);
    expect(removed.data.user).toBeNull();
    const kept = await service.auth.admin.getUserById(active.userId);
    expect(kept.data.user).not.toBeNull();
  });

  it("실제 본사는 지우지 않는다", async () => {
    must(await service.rpc("delete_expired_trials"));

    const org = must(
      await service.from("organizations").select("id").eq("id", f.orgA),
    );
    expect(org).toHaveLength(1);
  });
});

describe("실행 권한", () => {
  const cases: { name: string; args: Record<string, unknown> }[] = [
    {
      name: "create_trial_org",
      args: { p_user_id: "00000000-0000-0000-0000-000000000000" },
    },
    {
      name: "switch_trial_role",
      args: {
        p_user_id: "00000000-0000-0000-0000-000000000000",
        p_branch_id: null,
      },
    },
    { name: "delete_expired_trials", args: {} },
  ];

  it.each(cases)(
    "사용자는 $name을 직접 부를 수 없다",
    async ({ name, args }) => {
      const client = createClient<Database>(
        process.env.SUPABASE_URL ?? "",
        process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
        clientOptions,
      );
      const signedIn = await client.auth.signInWithPassword({
        email: f.users.hq.email,
        password: PASSWORD,
      });
      expect(signedIn.error).toBeNull();

      const { error } = await client.rpc(
        name as "delete_expired_trials",
        args as never,
      );

      expect(error?.code).toBe(DENIED);
    },
  );
});
