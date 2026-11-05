import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await f.cleanup();
});

const balanceOf = async (branchId: string) =>
  must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", branchId)
      .maybeSingle(),
  )?.balance ?? 0;

async function ready(amount = 10_000) {
  const orderId = `dh-${randomUUID()}`;
  must(
    await service
      .from("payments")
      .insert({
        org_id: f.orgA,
        branch_id: f.branch1,
        requested_by: f.users.branch1.id,
        order_id: orderId,
        amount,
      })
      .select("id"),
  );
  return orderId;
}

const confirm = (
  orderId: string,
  options: { key?: string; amount?: number } = {},
) =>
  service.rpc("confirm_payment", {
    p_order_id: orderId,
    p_payment_key: options.key ?? `pk-${orderId}`,
    p_amount: options.amount ?? 10_000,
    p_approved_at: new Date().toISOString(),
  });

describe("confirm_payment", () => {
  it("결제를 완료하고 잔액을 늘리며 거래 기록을 남긴다", async () => {
    const before = await balanceOf(f.branch1);
    const orderId = await ready();

    expect(must(await confirm(orderId))).toBe("charged");

    expect(await balanceOf(f.branch1)).toBe(before + 10_000);
    const payment = must(
      await service
        .from("payments")
        .select("id, status, payment_key, approved_at")
        .eq("order_id", orderId)
        .single(),
    );
    expect(payment.status).toBe("done");
    expect(payment.payment_key).toBe(`pk-${orderId}`);
    expect(payment.approved_at).not.toBeNull();
    const ledger = must(
      await service
        .from("ledger_entries")
        .select("kind, amount, branch_id")
        .eq("payment_id", payment.id),
    );
    expect(ledger).toEqual([
      { kind: "charge", amount: 10_000, branch_id: f.branch1 },
    ]);
  });

  it("같은 결제가 다시 와도 한 번만 충전한다", async () => {
    const before = await balanceOf(f.branch1);
    const orderId = await ready();
    must(await confirm(orderId));
    expect(must(await confirm(orderId))).toBe("already_done");
    expect(await balanceOf(f.branch1)).toBe(before + 10_000);
  });

  it("리다이렉트와 웹훅이 동시에 와도 한 번만 충전한다", async () => {
    const before = await balanceOf(f.branch1);
    const orderId = await ready();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => confirm(orderId)),
    );
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(results.filter((result) => result.data === "charged")).toHaveLength(
      1,
    );
    expect(await balanceOf(f.branch1)).toBe(before + 10_000);
  });

  it("금액이 다르면 기록하지 않는다", async () => {
    const before = await balanceOf(f.branch1);
    const orderId = await ready();
    const { error } = await confirm(orderId, { amount: 100 });
    expect(error?.code).toBe("DH019");
    expect(await balanceOf(f.branch1)).toBe(before);
  });

  it("없는 주문은 거부한다", async () => {
    const { error } = await confirm("dh-none");
    expect(error?.code).toBe("DH018");
  });

  it("완료된 주문에 다른 결제 키가 오면 거부한다", async () => {
    const orderId = await ready();
    must(await confirm(orderId));
    const { error } = await confirm(orderId, { key: "pk-other" });
    expect(error?.code).toBe("DH020");
  });

  it("실패로 표시됐어도 토스가 승인했으면 충전한다", async () => {
    const before = await balanceOf(f.branch1);
    const orderId = await ready();
    must(
      await service
        .from("payments")
        .update({ status: "failed" })
        .eq("order_id", orderId)
        .select("id"),
    );
    expect(must(await confirm(orderId))).toBe("charged");
    expect(await balanceOf(f.branch1)).toBe(before + 10_000);
  });

  it("취소된 결제는 충전하지 않는다", async () => {
    const orderId = await ready();
    must(
      await service
        .from("payments")
        .update({ status: "canceled" })
        .eq("order_id", orderId)
        .select("id"),
    );
    const { error } = await confirm(orderId);
    expect(error?.code).toBe("DH021");
  });

  it("사용자는 부를 수 없고 결제를 직접 고칠 수 없다", async () => {
    const orderId = await ready();
    const client = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${await f.tokenOf("branch1")}` },
        },
      },
    );
    const { error } = await client.rpc("confirm_payment", {
      p_order_id: orderId,
      p_payment_key: "pk",
      p_amount: 10_000,
      p_approved_at: new Date().toISOString(),
    });
    expect(error?.code).toBe("42501");

    await client.from("payments").update({ amount: 1 }).eq("order_id", orderId);
    const row = must(
      await service
        .from("payments")
        .select("amount")
        .eq("order_id", orderId)
        .single(),
    );
    expect(row.amount).toBe(10_000);
  });
});
