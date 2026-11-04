import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, must, service, type Fixture } from "./fixture";

/**
 * 서버 코드에 버그가 있어도 깨지지 않아야 하는 규칙을 검사한다. 그래서 RLS를 건너뛰는 service 클라이언트를 쓴다.
 * 오류 코드를 함께 보는 이유: 아무 오류로나 통과하면 다른 이유로 실패해도 모른다.
 */
const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await f.cleanup();
});

function campaignOf(branchId: string | null) {
  const campaign = f.campaigns.find(
    (c) => c.org_id === f.orgA && c.branch_id === branchId,
  );
  if (!campaign) throw new Error("발송 건을 찾지 못했다");
  return campaign;
}

describe("구성원", () => {
  it("본사 역할에 지점이 있으면 거부한다", async () => {
    const { error } = await service
      .from("members")
      .update({ role: "hq" })
      .eq("user_id", f.users.branch1.id);
    expect(error?.code).toBe(CHECK);
  });

  it("지점 역할에 지점이 없으면 거부한다", async () => {
    const { error } = await service
      .from("members")
      .update({ branch_id: null })
      .eq("user_id", f.users.branch1.id);
    expect(error?.code).toBe(CHECK);
  });

  it("지점에 담당자를 두 명 둘 수 없다", async () => {
    const { error } = await service
      .from("members")
      .update({ branch_id: f.branch1 })
      .eq("user_id", f.users.branch2.id);
    expect(error?.code).toBe(UNIQUE);
  });

  it("다른 본사의 지점에 소속될 수 없다", async () => {
    const { error } = await service
      .from("members")
      .update({ branch_id: f.branchB })
      .eq("user_id", f.users.branch1.id);
    expect(error?.code).toBe(FOREIGN_KEY);
  });
});

describe("전화번호", () => {
  it.each(["010-0000-0001", "010 0000 0001", "+821000000001", "1234567", ""])(
    "정규화되지 않은 값 %j를 거부한다",
    async (phone) => {
      const { error } = await service
        .from("contacts")
        .insert({ org_id: f.orgA, branch_id: f.branch1, phone });
      expect(error?.code).toBe(CHECK);
    },
  );

  it("같은 지점에 같은 번호를 두 번 넣을 수 없지만 다른 지점은 가능하다", async () => {
    const phone = "01000002001";
    must(
      await service
        .from("contacts")
        .insert({ org_id: f.orgA, branch_id: f.branch1, phone })
        .select("id"),
    );
    const sameBranch = await service
      .from("contacts")
      .insert({ org_id: f.orgA, branch_id: f.branch1, phone });
    const otherBranch = await service
      .from("contacts")
      .insert({ org_id: f.orgA, branch_id: f.branch2, phone });

    expect(sameBranch.error?.code).toBe(UNIQUE);
    expect(otherBranch.error).toBeNull();
  });
});

describe("발신번호", () => {
  it("지점의 대표 번호는 하나뿐이다", async () => {
    must(
      await service
        .from("sender_numbers")
        .insert({
          org_id: f.orgA,
          branch_id: f.branch1,
          number: "01000003001",
          label: "대표",
          is_default: true,
        })
        .select("id"),
    );
    const { error } = await service.from("sender_numbers").insert({
      org_id: f.orgA,
      branch_id: f.branch1,
      number: "01000003002",
      label: "둘째 대표",
      is_default: true,
    });
    expect(error?.code).toBe(UNIQUE);
  });

  it("본사 계정(branch_id null)도 대표 번호와 번호 중복이 막힌다", async () => {
    // null은 기본적으로 서로 다른 값이라 지점과 같은 제약만 두면 통과해 버린다.
    must(
      await service
        .from("sender_numbers")
        .insert({
          org_id: f.orgA,
          branch_id: null,
          number: "15881234",
          label: "대표",
          is_default: true,
        })
        .select("id"),
    );
    const secondDefault = await service.from("sender_numbers").insert({
      org_id: f.orgA,
      branch_id: null,
      number: "15881235",
      label: "둘째 대표",
      is_default: true,
    });
    const sameNumber = await service.from("sender_numbers").insert({
      org_id: f.orgA,
      branch_id: null,
      number: "15881234",
      label: "같은 번호",
    });

    expect(secondDefault.error?.code).toBe(UNIQUE);
    expect(sameNumber.error?.code).toBe(UNIQUE);
  });
});

describe("발송 건", () => {
  it("반려에는 사유가 필요하고, 반려가 아니면 사유를 둘 수 없다", async () => {
    const id = campaignOf(f.branch1).id;
    const noReason = await service
      .from("campaigns")
      .update({ status: "rejected" })
      .eq("id", id);
    const strayReason = await service
      .from("campaigns")
      .update({ rejected_reason: "사유" })
      .eq("id", id);

    expect(noReason.error?.code).toBe(CHECK);
    expect(strayReason.error?.code).toBe(CHECK);
  });

  it("작성 중이 아니면 발신번호가 필요하다", async () => {
    const { error } = await service.from("campaigns").insert({
      org_id: f.orgA,
      branch_id: f.branch1,
      status: "scheduled",
    });
    expect(error?.code).toBe(CHECK);
  });

  it("예상 금액은 수신자 수 × 단가와 같아야 한다", async () => {
    const { error } = await service.from("campaigns").insert({
      org_id: f.orgA,
      branch_id: f.branch1,
      recipient_count: 10,
      unit_price: 20,
      estimated_cost: 1,
    });
    expect(error?.code).toBe(CHECK);
  });

  it("도착·실패 합계가 수신자 수를 넘을 수 없다", async () => {
    const { error } = await service
      .from("campaigns")
      .update({ delivered_count: 2 })
      .eq("id", campaignOf(f.branch1).id);
    expect(error?.code).toBe(CHECK);
  });

  it("재발송은 원본을 바꾸지 않고 새 행으로 잇는다", async () => {
    const original = campaignOf(f.branch1);
    const retry = must(
      await service
        .from("campaigns")
        .insert({
          org_id: f.orgA,
          branch_id: f.branch1,
          retry_of_campaign_id: original.id,
        })
        .select("retry_of_campaign_id")
        .single(),
    );
    expect(retry.retry_of_campaign_id).toBe(original.id);
  });

  it("다른 본사의 발송 건을 재발송 원본으로 삼을 수 없다", async () => {
    const { error } = await service.from("campaigns").insert({
      org_id: f.orgB,
      branch_id: f.branchB,
      retry_of_campaign_id: campaignOf(f.branch1).id,
    });
    expect(error?.code).toBe(FOREIGN_KEY);
  });
});

describe("메시지", () => {
  it("넘긴 소속을 무시하고 발송 건의 소속을 복사한다", async () => {
    const message = must(
      await service
        .from("messages")
        .insert({
          campaign_id: campaignOf(f.branch1).id,
          org_id: f.orgB,
          branch_id: f.branchB,
          phone: "01000004001",
        })
        .select("org_id, branch_id")
        .single(),
    );
    expect(message).toEqual({ org_id: f.orgA, branch_id: f.branch1 });
  });

  it("본사 발송의 메시지는 지점이 null이다", async () => {
    const message = must(
      await service
        .from("messages")
        .insert({
          campaign_id: campaignOf(null).id,
          org_id: f.orgB,
          branch_id: f.branchB,
          phone: "01000004002",
        })
        .select("org_id, branch_id")
        .single(),
    );
    expect(message).toEqual({ org_id: f.orgA, branch_id: null });
  });

  it("같은 발송 건에 같은 번호를 두 번 넣을 수 없다", async () => {
    const { error } = await service.from("messages").insert({
      campaign_id: campaignOf(f.branch1).id,
      org_id: f.orgA,
      phone: "01000000001",
    });
    expect(error?.code).toBe(UNIQUE);
  });

  it.each([
    { name: "sent에 업체 id 없음", patch: { status: "sent" as const } },
    {
      name: "failed에 실패 코드 없음",
      patch: {
        status: "failed" as const,
        finalized_at: "2026-11-04T00:00:00Z",
      },
    },
    {
      name: "delivered에 확정 시각 없음",
      patch: { status: "delivered" as const },
    },
    {
      name: "대기 중인데 확정 시각 있음",
      patch: { finalized_at: "2026-11-04T00:00:00Z" },
    },
  ])("$name은 거부한다", async ({ patch }) => {
    const { error } = await service
      .from("messages")
      .update(patch)
      .eq("campaign_id", campaignOf(f.branch2).id);
    expect(error?.code).toBe(CHECK);
  });
});

describe("거래 기록", () => {
  const paidEntry = {
    kind: "charge" as const,
    amount: 1000,
  };

  it.each([
    { name: "reserve가 양수", kind: "reserve" as const, amount: 10 },
    { name: "release가 음수", kind: "release" as const, amount: -10 },
    { name: "refund가 음수", kind: "refund" as const, amount: -10 },
    { name: "금액 0", kind: "release" as const, amount: 0 },
  ])("$name이면 거부한다", async ({ kind, amount }) => {
    const { error } = await service.from("ledger_entries").insert({
      org_id: f.orgA,
      branch_id: f.branch1,
      kind,
      amount,
      campaign_id: campaignOf(f.branch1).id,
      idempotency_key: `sign:${kind}:${amount}`,
    });
    expect(error?.code).toBe(CHECK);
  });

  it("charge에 결제 연결이 없으면 거부한다", async () => {
    const { error } = await service.from("ledger_entries").insert({
      ...paidEntry,
      org_id: f.orgA,
      branch_id: f.branch1,
      campaign_id: campaignOf(f.branch1).id,
      idempotency_key: "link:charge",
    });
    expect(error?.code).toBe(CHECK);
  });

  it("키를 바꿔도 같은 결제로 두 번 충전할 수 없다", async () => {
    const payment = must(
      await service
        .from("ledger_entries")
        .select("payment_id")
        .eq("branch_id", f.branch1)
        .eq("kind", "charge")
        .limit(1)
        .single(),
    );
    const { error } = await service.from("ledger_entries").insert({
      ...paidEntry,
      org_id: f.orgA,
      branch_id: f.branch1,
      payment_id: payment.payment_id,
      idempotency_key: "duplicate-charge",
    });
    expect(error?.code).toBe(UNIQUE);
  });

  it("같은 멱등 키를 다시 쓸 수 없다", async () => {
    const first = must(
      await service
        .from("ledger_entries")
        .insert({
          org_id: f.orgA,
          branch_id: f.branch2,
          kind: "refund",
          amount: 1,
          campaign_id: campaignOf(f.branch2).id,
          idempotency_key: "same-key",
        })
        .select("id"),
    );
    expect(first).toHaveLength(1);

    const { error } = await service.from("ledger_entries").insert({
      org_id: f.orgA,
      branch_id: f.branch1,
      kind: "refund",
      amount: 1,
      campaign_id: campaignOf(f.branch1).id,
      idempotency_key: "same-key",
    });
    expect(error?.code).toBe(UNIQUE);
  });
});

describe("삭제", () => {
  it("자식이 있는 지점은 단독으로 지울 수 없다", async () => {
    const { error } = await service
      .from("branches")
      .delete()
      .eq("id", f.branch1);
    expect(error?.code).toBe(FOREIGN_KEY);
  });

  it("본사를 지우면 체험 데이터가 연쇄로 모두 지워진다", async () => {
    // 체험 계정 정리가 이 동작에 의존한다. 별도 본사를 만들어 다른 테스트에 영향을 주지 않는다.
    const trial = await createFixture();
    const orgIds = [trial.orgA, trial.orgB];

    must(
      await service
        .from("organizations")
        .delete()
        .in("id", orgIds)
        .select("id"),
    );

    for (const table of [
      "branches",
      "members",
      "sender_numbers",
      "contacts",
      "contact_groups",
      "contact_group_members",
      "opt_outs",
      "campaigns",
      "messages",
      "payments",
      "ledger_entries",
    ] as const) {
      const { count, error } = await service
        .from(table)
        .select("*", { count: "exact", head: true })
        .in("org_id", orgIds);
      expect(error, table).toBeNull();
      expect(count, table).toBe(0);
    }

    await trial.cleanup();
  });
});
