import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRecipients } from "@/features/campaigns/recipients";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

const INSUFFICIENT_BALANCE = "DH004";
const INVALID_STATUS = "DH007";
const NO_RECIPIENTS = "DH008";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await f.cleanup();
});

const recipients = (count: number, base = 5000) =>
  Array.from({ length: count }, (_, index) => ({
    phone: `0100000${String(base + index).padStart(4, "0")}`,
    name: `고객${index}`,
  }));

function submit(
  overrides: Partial<{
    id: string;
    branch: string | null;
    status: "scheduled" | "pending_approval" | "sending";
    people: { phone: string; name: string }[];
    unitPrice: number;
    scheduledAt: string | null;
  }> = {},
) {
  return service.rpc("submit_campaign", {
    p_client_request_id: overrides.id ?? randomUUID(),
    p_org_id: f.orgA,
    p_branch_id: (overrides.branch === undefined
      ? f.branch1
      : overrides.branch) as string,
    p_created_by: f.users.branch1.id,
    p_body: "본문",
    p_kind: "sms",
    p_is_ad: false,
    p_sender_phone: "0212345678",
    p_status: overrides.status ?? "scheduled",
    p_scheduled_at: (overrides.scheduledAt ?? null) as string,
    p_unit_price: overrides.unitPrice ?? 1,
    p_recipients: overrides.people ?? recipients(3),
  });
}

async function balanceOf(branchId: string) {
  const row = must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", branchId)
      .single(),
  );
  return row.balance ?? 0;
}

describe("submit_campaign", () => {
  it("발송 건·메시지를 만들고 잔액을 선점한다", async () => {
    const before = await balanceOf(f.branch1);
    const id = must(await submit());

    const campaign = must(
      await service
        .from("campaigns")
        .select("status, recipient_count, estimated_cost")
        .eq("id", id)
        .single(),
    );
    const messages = must(
      await service
        .from("messages")
        .select("status, org_id, branch_id")
        .eq("campaign_id", id),
    );

    expect(campaign).toEqual({
      status: "scheduled",
      recipient_count: 3,
      estimated_cost: 3,
    });
    expect(messages).toHaveLength(3);
    expect(messages.every((m) => m.status === "queued")).toBe(true);
    expect(messages[0]).toMatchObject({ org_id: f.orgA, branch_id: f.branch1 });
    expect(await balanceOf(f.branch1)).toBe(before - 3);
  });

  it("같은 요청을 다시 보내면 같은 발송 건이고 다시 차감하지 않는다", async () => {
    const id = randomUUID();
    const before = await balanceOf(f.branch1);

    const first = must(await submit({ id }));
    const second = must(await submit({ id }));

    expect(second).toBe(first);
    expect(await balanceOf(f.branch1)).toBe(before - 3);
    const campaigns = must(
      await service.from("campaigns").select("id").eq("client_request_id", id),
    );
    expect(campaigns).toHaveLength(1);
  });

  it("같은 요청을 동시에 보내도 한 건만 만든다", async () => {
    const id = randomUUID();
    const before = await balanceOf(f.branch1);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => submit({ id })),
    );

    expect(results.every((r) => r.error === null)).toBe(true);
    expect(new Set(results.map((r) => r.data)).size).toBe(1);
    expect(await balanceOf(f.branch1)).toBe(before - 3);
  });

  it("승인 전 광고는 잔액을 차감하지 않고 요청 시각을 남긴다", async () => {
    const before = await balanceOf(f.branch2);
    const id = must(
      await submit({ branch: f.branch2, status: "pending_approval" }),
    );

    const campaign = must(
      await service
        .from("campaigns")
        .select("status, requested_at")
        .eq("id", id)
        .single(),
    );
    expect(campaign.status).toBe("pending_approval");
    expect(campaign.requested_at).not.toBeNull();
    expect(await balanceOf(f.branch2)).toBe(before);
  });

  it("잔액이 부족하면 아무것도 남기지 않는다", async () => {
    const id = randomUUID();
    const before = await balanceOf(f.branch2);

    const { error } = await submit({
      id,
      branch: f.branch2,
      unitPrice: 1_000_000,
    });

    expect(error?.code).toBe(INSUFFICIENT_BALANCE);
    const left = must(
      await service.from("campaigns").select("id").eq("client_request_id", id),
    );
    expect(left).toEqual([]);
    expect(await balanceOf(f.branch2)).toBe(before);
  });

  it("중간에 실패하면 발송 건도 남지 않는다", async () => {
    const id = randomUUID();
    const { error } = await submit({
      id,
      // 같은 번호가 두 번이면 메시지 저장에서 실패한다.
      people: [
        { phone: "01000006001", name: "a" },
        { phone: "01000006001", name: "b" },
      ],
    });

    expect(error).not.toBeNull();
    const left = must(
      await service.from("campaigns").select("id").eq("client_request_id", id),
    );
    expect(left).toEqual([]);
  });

  it("예약 시각이 메시지의 다음 시도 시각이 된다", async () => {
    const scheduledAt = "2030-01-01T01:00:00.000Z";
    const id = must(await submit({ scheduledAt }));
    const message = must(
      await service
        .from("messages")
        .select("next_attempt_at")
        .eq("campaign_id", id)
        .limit(1)
        .single(),
    );
    expect(new Date(message.next_attempt_at).toISOString()).toBe(scheduledAt);
  });

  it("접수로 만들 수 없는 상태를 거부한다", async () => {
    const { error } = await submit({ status: "sending" });
    expect(error?.code).toBe(INVALID_STATUS);
  });

  it("수신자가 없으면 거부한다", async () => {
    const { error } = await submit({ people: [] });
    expect(error?.code).toBe(NO_RECIPIENTS);
  });

  it("사용자는 직접 부를 수 없다", async () => {
    const token = await f.tokenOf("branch1");
    const client = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { error } = await client.rpc("submit_campaign", {
      p_client_request_id: randomUUID(),
      p_org_id: f.orgA,
      p_branch_id: f.branch1,
      p_created_by: f.users.branch1.id,
      p_body: "본문",
      p_kind: "sms",
      p_is_ad: false,
      p_sender_phone: "0212345678",
      p_status: "scheduled",
      p_scheduled_at: null as unknown as string,
      p_unit_price: 1,
      p_recipients: recipients(1, 7000),
    });
    expect(error?.code).toBe("42501");
  });
});

describe("resolveRecipients", () => {
  let groupA: string;
  let groupB: string;
  let contactIds: string[];

  const asUser = async (user: "branch1" | "branch2" | "hq") => {
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

  beforeAll(async () => {
    const contacts = must(
      await service
        .from("contacts")
        .insert(
          ["01000008001", "01000008002", "01000008003"].map((phone) => ({
            org_id: f.orgA,
            branch_id: f.branch1,
            phone,
            name: `받는${phone.slice(-1)}`,
          })),
        )
        .select("id, phone")
        .order("phone"),
    );
    contactIds = contacts.map((contact) => contact.id);
    const groups = must(
      await service
        .from("contact_groups")
        .insert([
          { org_id: f.orgA, branch_id: f.branch1, name: "수신A" },
          { org_id: f.orgA, branch_id: f.branch1, name: "수신B" },
        ])
        .select("id, name")
        .order("name"),
    );
    groupA = groups[0]?.id ?? "";
    groupB = groups[1]?.id ?? "";
    must(
      await service
        .from("contact_group_members")
        .insert(
          [
            [groupA, contactIds[0]],
            [groupA, contactIds[1]],
            [groupB, contactIds[1]],
            [groupB, contactIds[2]],
          ].map(([group_id, contact_id]) => ({
            group_id: group_id ?? "",
            contact_id: contact_id ?? "",
            org_id: f.orgA,
            branch_id: f.branch1,
          })),
        )
        .select("group_id"),
    );
    must(
      await service
        .from("opt_outs")
        .insert({ org_id: f.orgA, phone: "01000008003", source: "manual" })
        .select("id"),
    );
  });

  it("그룹 사이 중복을 빼고 수신거부를 제외한다", async () => {
    const result = await resolveRecipients(
      await asUser("branch1"),
      [groupA, groupB],
      [],
    );
    expect(result.recipients.map((r) => r.phone).sort()).toEqual([
      "01000008001",
      "01000008002",
    ]);
    expect(result).toMatchObject({ optedOut: 1, duplicates: 1 });
  });

  it("그룹과 직접 선택을 합쳐도 번호는 한 번만 나온다", async () => {
    const result = await resolveRecipients(
      await asUser("branch1"),
      [groupA],
      [contactIds[0] ?? ""],
    );
    expect(result.recipients).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  it("다른 지점의 그룹과 연락처는 수신자가 되지 않는다", async () => {
    const result = await resolveRecipients(
      await asUser("branch2"),
      [groupA],
      contactIds,
    );
    expect(result.recipients).toEqual([]);
  });
});
