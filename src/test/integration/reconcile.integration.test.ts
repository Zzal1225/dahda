import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  LookupResult,
  SmsProvider,
} from "@/server/providers/sms-provider";
import {
  RESULT_TIMEOUT_CODE,
  runReconcileTick,
} from "@/server/queue/reconcile";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { createFixture, must, service, type Fixture } from "./fixture";

const HOUR = 3_600_000;
let f: Fixture;
const store = createSupabaseQueueStore(service);

beforeAll(async () => {
  f = await createFixture();
  await service.from("messages").delete().eq("status", "sent");
});
afterAll(async () => {
  await f.cleanup();
});

/** 접수된 지 ageHours 지난 발송 건을 만든다. */
async function sent(ageHours: number, provider = "solapi") {
  const id = must(
    await service.rpc("submit_campaign", {
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
      p_unit_price: 10,
      p_recipients: [
        {
          phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
          name: null,
        },
      ],
    }),
  );
  must(
    await service
      .from("campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", id)
      .select("id"),
  );
  const providerMessageId = `P-${randomUUID()}`;
  must(
    await service
      .from("messages")
      .update({
        status: "sent",
        provider,
        provider_message_id: providerMessageId,
        sent_at: new Date(Date.now() - ageHours * HOUR).toISOString(),
      })
      .eq("campaign_id", id)
      .select("id"),
  );
  return { id, providerMessageId };
}

const tick = (lookup: (ids: readonly string[]) => Promise<LookupResult[]>) =>
  runReconcileTick({
    store,
    providerFor: () =>
      ({ name: "solapi", fetchResults: lookup }) as unknown as SmsProvider,
  });

const campaign = async (id: string) =>
  must(
    await service
      .from("campaigns")
      .select("status, delivered_count, failed_count")
      .eq("id", id)
      .single(),
  );
const ledger = async (id: string) =>
  must(
    await service
      .from("ledger_entries")
      .select("kind, amount")
      .eq("campaign_id", id)
      .order("id"),
  );

describe("멈춘 발송 보정", () => {
  it("1시간 전 접수 건은 조회로 도착 처리하고 완료한다", async () => {
    const { id, providerMessageId } = await sent(2);
    await tick(async () => [
      { providerMessageId, status: "delivered", occurredAt: null },
    ]);
    expect(await campaign(id)).toEqual({
      status: "completed",
      delivered_count: 1,
      failed_count: 0,
    });
    expect(await ledger(id)).toEqual([{ kind: "reserve", amount: -10 }]);
  });

  it("결과 없이 72시간이 지나면 실패로 확정하고 환불한다", async () => {
    const { id } = await sent(73);
    await tick(async () => []);
    expect(await campaign(id)).toMatchObject({
      status: "completed",
      failed_count: 1,
    });
    expect(await ledger(id)).toEqual([
      { kind: "reserve", amount: -10 },
      { kind: "release", amount: 10 },
    ]);
    const message = must(
      await service
        .from("messages")
        .select("fail_code")
        .eq("campaign_id", id)
        .single(),
    );
    expect(message.fail_code).toBe(RESULT_TIMEOUT_CODE);
  });

  it("1시간이 안 된 건과 가짜 발송기 건은 조회하지 않는다", async () => {
    const recent = await sent(0.5);
    const fake = await sent(5, "fake");
    const asked: string[] = [];
    await tick(async (ids) => {
      asked.push(...ids);
      return [];
    });
    expect(asked).not.toContain(recent.providerMessageId);
    expect(asked).not.toContain(fake.providerMessageId);
  });

  it("보정과 웹훅 결과가 겹쳐도 한 번만 환불한다", async () => {
    const { id, providerMessageId } = await sent(2);
    const lookup = async (): Promise<LookupResult[]> => [
      {
        providerMessageId,
        status: "failed",
        failCode: "3032",
        occurredAt: null,
      },
    ];
    await Promise.all([tick(lookup), tick(lookup)]);
    expect(await ledger(id)).toEqual([
      { kind: "reserve", amount: -10 },
      { kind: "release", amount: 10 },
    ]);
  });
});
