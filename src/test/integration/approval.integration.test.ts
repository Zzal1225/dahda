import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countApprovals,
  getApproval,
  listApprovals,
} from "@/features/campaigns/approval-query";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

const INSUFFICIENT = "DH004";
const NOT_PENDING = "DH009";
const NOT_CANCELABLE = "DH010";
const APPROVED = "DH011";
const TOO_LATE = "DH012";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await f.cleanup();
});

const FUTURE = "2030-01-01T01:00:00.000Z";

async function balance(branchId: string) {
  const row = must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", branchId)
      .single(),
  );
  return row.balance ?? 0;
}

async function requestApproval(
  branch = f.branch1,
  unitPrice = 1,
  count = 3,
  orgId = f.orgA,
) {
  return must(
    await service.rpc("submit_campaign", {
      p_client_request_id: randomUUID(),
      p_org_id: orgId,
      p_branch_id: branch,
      p_created_by: f.users.branch1.id,
      p_body: "(광고)a\n본문\n무료거부",
      p_kind: "sms",
      p_is_ad: true,
      p_sender_phone: "0212345678",
      p_status: "pending_approval",
      p_scheduled_at: FUTURE,
      p_unit_price: unitPrice,
      p_recipients: Array.from({ length: count }, (_, index) => ({
        phone: `0100000${String(5000 + index).padStart(4, "0")}`,
        name: null,
      })),
    }),
  );
}

async function schedule(
  scheduledAt: string | null = FUTURE,
  branch: string | null = f.branch2,
) {
  return must(
    await service.rpc("submit_campaign", {
      p_client_request_id: randomUUID(),
      p_org_id: f.orgA,
      p_branch_id: branch as string,
      p_created_by: f.users.branch2.id,
      p_body: "본문",
      p_kind: "sms",
      p_is_ad: false,
      p_sender_phone: "0212345678",
      p_status: "scheduled",
      p_scheduled_at: scheduledAt as string,
      p_unit_price: 1,
      p_recipients: [
        { phone: "01000005000", name: null },
        { phone: "01000005001", name: null },
      ],
    }),
  );
}

const approve = (id: string, org = f.orgA) =>
  service.rpc("approve_campaign", {
    p_campaign_id: id,
    p_org_id: org,
    p_reviewer: f.users.hq.id,
  });
const reject = (id: string, org = f.orgA) =>
  service.rpc("reject_campaign", {
    p_campaign_id: id,
    p_org_id: org,
    p_reviewer: f.users.hq.id,
    p_reason: "문구 수정",
  });
const cancel = (id: string, branch: string | null = f.branch2) =>
  service.rpc("cancel_campaign", {
    p_campaign_id: id,
    p_org_id: f.orgA,
    p_branch_id: branch as string,
  });

const campaignOf = async (id: string) =>
  must(
    await service
      .from("campaigns")
      .select("status, rejected_reason, reviewed_by, reviewed_at")
      .eq("id", id)
      .single(),
  );
const messageCount = async (id: string) =>
  must(await service.from("messages").select("id").eq("campaign_id", id))
    .length;

describe("approve_campaign", () => {
  it("승인하면 지점 잔액을 차감하고 예약 상태가 된다", async () => {
    const id = await requestApproval();
    const before = await balance(f.branch1);

    expect((await approve(id)).error).toBeNull();

    expect(await campaignOf(id)).toMatchObject({
      status: "scheduled",
      reviewed_by: f.users.hq.id,
    });
    expect(await balance(f.branch1)).toBe(before - 3);
    expect(await messageCount(id)).toBe(3);
  });

  it("잔액이 부족하면 승인 대기로 남고 차감도 없다", async () => {
    const id = await requestApproval(f.branch1, 10_000_000);
    const before = await balance(f.branch1);

    const { error } = await approve(id);

    expect(error?.code).toBe(INSUFFICIENT);
    expect((await campaignOf(id)).status).toBe("pending_approval");
    expect(await balance(f.branch1)).toBe(before);
  });

  it("두 번 승인해도 한 번만 차감한다", async () => {
    const id = await requestApproval();
    const before = await balance(f.branch1);

    await approve(id);
    const { error } = await approve(id);

    expect(error?.code).toBe(NOT_PENDING);
    expect(await balance(f.branch1)).toBe(before - 3);
  });

  it("동시에 승인해도 하나만 성공한다", async () => {
    const id = await requestApproval();
    const before = await balance(f.branch1);

    const results = await Promise.all([approve(id), approve(id), approve(id)]);

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(await balance(f.branch1)).toBe(before - 3);
  });

  it("승인과 반려가 겹쳐도 한쪽만 성공하고 돈과 상태가 맞는다", async () => {
    const id = await requestApproval();
    const before = await balance(f.branch1);

    const [approved, rejected] = await Promise.all([approve(id), reject(id)]);

    expect(
      [approved.error, rejected.error].filter((e) => e === null),
    ).toHaveLength(1);
    const { status } = await campaignOf(id);
    expect(await balance(f.branch1)).toBe(
      status === "scheduled" ? before - 3 : before,
    );
  });

  it("다른 본사의 요청은 승인할 수 없다", async () => {
    const id = await requestApproval();
    const { error } = await approve(id, f.orgB);
    expect(error?.code).toBe(NOT_PENDING);
    expect((await campaignOf(id)).status).toBe("pending_approval");
  });
});

describe("reject_campaign", () => {
  it("사유를 남기고 메시지를 지우며 잔액은 그대로다", async () => {
    const id = await requestApproval();
    const before = await balance(f.branch1);

    expect((await reject(id)).error).toBeNull();

    expect(await campaignOf(id)).toMatchObject({
      status: "rejected",
      rejected_reason: "문구 수정",
    });
    expect(await messageCount(id)).toBe(0);
    expect(await balance(f.branch1)).toBe(before);
  });

  it("승인된 건은 반려할 수 없다", async () => {
    const id = await requestApproval();
    await approve(id);
    expect((await reject(id)).error?.code).toBe(NOT_PENDING);
  });
});

describe("cancel_campaign", () => {
  it("취소하면 환불하고 메시지를 지운다", async () => {
    const before = await balance(f.branch2);
    const id = await schedule();
    expect(await balance(f.branch2)).toBe(before - 2);

    expect((await cancel(id)).error).toBeNull();

    expect((await campaignOf(id)).status).toBe("canceled");
    expect(await messageCount(id)).toBe(0);
    expect(await balance(f.branch2)).toBe(before);
    const refund = must(
      await service
        .from("ledger_entries")
        .select("kind, amount")
        .eq("campaign_id", id)
        .eq("kind", "refund"),
    );
    expect(refund).toEqual([{ kind: "refund", amount: 2 }]);
  });

  it("두 번 취소해도 한 번만 환불한다", async () => {
    const id = await schedule();
    await cancel(id);
    const after = await balance(f.branch2);

    expect((await cancel(id)).error?.code).toBe(NOT_CANCELABLE);
    expect(await balance(f.branch2)).toBe(after);
  });

  it("승인된 건은 취소할 수 없다", async () => {
    const id = await requestApproval();
    await approve(id);
    expect((await cancel(id, f.branch1)).error?.code).toBe(APPROVED);
  });

  it("지금 보내기와 시각이 지난 예약은 취소할 수 없다", async () => {
    const now = await schedule(null);
    const past = await schedule("2020-01-01T00:00:00Z");
    expect((await cancel(now)).error?.code).toBe(TOO_LATE);
    expect((await cancel(past)).error?.code).toBe(TOO_LATE);
  });

  it("다른 계정의 예약은 취소할 수 없다", async () => {
    const id = await schedule();
    expect((await cancel(id, f.branch1)).error?.code).toBe(NOT_CANCELABLE);
    // 본사도 지점 예약을 대신 취소하지 못한다.
    expect((await cancel(id, null)).error?.code).toBe(NOT_CANCELABLE);
  });

  it("승인 대기 건은 취소할 수 없다", async () => {
    const id = await requestApproval();
    expect((await cancel(id, f.branch1)).error?.code).toBe(NOT_CANCELABLE);
  });
});

describe("승인 조회", () => {
  const asUser = async (user: "hq" | "branch1" | "otherHq") => {
    const token = await f.tokenOf(user);
    return createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
  };

  it("본사는 자기 본사의 대기 건만 지점 이름과 함께 본다", async () => {
    const id = await requestApproval();
    const rows = await listApprovals(await asUser("hq"));
    expect(rows.find((row) => row.id === id)?.branchName).toBe("성수점");

    const other = await listApprovals(await asUser("otherHq"));
    expect(other.some((row) => row.id === id)).toBe(false);
  });

  it("상세에 지점 잔액이 있고 처리된 건은 찾지 못한다", async () => {
    const id = await requestApproval();
    const client = await asUser("hq");
    expect((await getApproval(client, id))?.balance).toBe(
      await balance(f.branch1),
    );

    await reject(id);
    expect(await getApproval(client, id)).toBeNull();
  });

  it("대기 건수를 센다", async () => {
    const client = await asUser("hq");
    const before = await countApprovals(client);
    await requestApproval();
    expect(await countApprovals(client)).toBe(before + 1);
  });
});

describe("실행 권한", () => {
  it.each(["approve_campaign", "reject_campaign", "cancel_campaign"] as const)(
    "사용자는 %s를 직접 부를 수 없다",
    async (name) => {
      const token = await f.tokenOf("hq");
      const client = createClient<Database>(
        process.env.SUPABASE_URL ?? "",
        process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        },
      );
      const args = {
        p_campaign_id: randomUUID(),
        p_org_id: f.orgA,
        ...(name === "cancel_campaign"
          ? { p_branch_id: null }
          : { p_reviewer: f.users.hq.id }),
        ...(name === "reject_campaign" ? { p_reason: "x" } : {}),
      };
      const { error } = await client.rpc(name, args as never);
      expect(error?.code).toBe("42501");
    },
  );
});
