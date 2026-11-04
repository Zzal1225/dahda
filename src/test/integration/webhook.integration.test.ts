import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFakeProvider,
  signFakeWebhook,
} from "@/server/providers/fake/fake-provider";
import type { SendResult, SmsProvider } from "@/server/providers/sms-provider";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { runWorkerTick } from "@/server/queue/worker";
import { processSmsWebhook } from "@/server/webhooks/process-sms-webhook";
import { createFixture, must, service, type Fixture } from "./fixture";

const SECRET = "integration-secret";
const provider = createFakeProvider({
  secret: SECRET,
  deliver: async () => {},
  onDeliveryError: () => {},
});

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
  await service.from("messages").delete().eq("status", "queued");
});
afterAll(async () => {
  await f.cleanup();
});

const accepting: SmsProvider = {
  ...provider,
  send: async (batch) =>
    batch.map((request): SendResult => ({
      idempotencyKey: request.idempotencyKey,
      outcome: "accepted",
      providerMessageId: `fake-${request.idempotencyKey}`,
    })),
};

async function submit(count: number, unitPrice = 10) {
  return must(
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
      p_unit_price: unitPrice,
      p_recipients: Array.from({ length: count }, (_, index) => ({
        phone: `0100000${String(7000 + index).padStart(4, "0")}`,
        name: null,
      })),
    }),
  );
}

const tick = (sms: SmsProvider = accepting) =>
  runWorkerTick({
    store: createSupabaseQueueStore(service),
    providerFor: () => sms,
    batchSize: 1000,
    leaseSeconds: 300,
  });

const keysOf = async (campaignId: string) =>
  must(
    await service
      .from("messages")
      .select("idempotency_key")
      .eq("campaign_id", campaignId)
      .order("id"),
  ).map((row) => row.idempotency_key);

type Result = { status: "delivered" } | { status: "failed"; failCode: string };

const event = (key: string, result: Result = { status: "delivered" }) => ({
  ...result,
  providerMessageId: `fake-${key}`,
  idempotencyKey: key,
  occurredAt: new Date().toISOString(),
});

async function post(events: unknown[]) {
  const rawBody = JSON.stringify({ events });
  return processSmsWebhook({
    provider,
    request: await signFakeWebhook(SECRET, rawBody),
    supabase: service,
  });
}

const lastEvent = async () =>
  must(
    await service
      .from("webhook_events")
      .select("raw_body, signature_valid, process_result, error, processed_at")
      .order("id", { ascending: false })
      .limit(1)
      .single(),
  );
const campaignOf = async (id: string) =>
  must(
    await service
      .from("campaigns")
      .select("status, sent_count, delivered_count, failed_count, completed_at")
      .eq("id", id)
      .single(),
  );
const messageOf = async (key: string) =>
  must(
    await service
      .from("messages")
      .select(
        "status, fail_code, provider, provider_message_id, sent_at, finalized_at",
      )
      .eq("idempotency_key", key)
      .single(),
  );
const balance = async () =>
  must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", f.branch1)
      .single(),
  ).balance ?? 0;

describe("서명과 원문", () => {
  it("서명이 맞으면 원문을 저장하고 상태를 바꾼다", async () => {
    const id = await submit(2);
    await tick();
    const [key] = await keysOf(id);

    const { status } = await post([event(key ?? "")]);

    expect(status).toBe(200);
    expect(await messageOf(key ?? "")).toMatchObject({ status: "delivered" });
    const saved = await lastEvent();
    expect(saved).toMatchObject({
      signature_valid: true,
      process_result: "applied",
    });
    expect(saved.raw_body).toContain(key);
    expect(saved.processed_at).not.toBeNull();
  });

  it("서명이 틀리면 401이고 기록만 남는다", async () => {
    const id = await submit(1);
    await tick();
    const [key] = await keysOf(id);
    const signed = await signFakeWebhook(
      "wrong-secret",
      JSON.stringify({ events: [event(key ?? "")] }),
    );

    const { status } = await processSmsWebhook({
      provider,
      request: signed,
      supabase: service,
    });

    expect(status).toBe(401);
    expect((await messageOf(key ?? "")).status).toBe("sent");
    expect(await lastEvent()).toMatchObject({
      signature_valid: false,
      process_result: "invalid_signature",
    });
  });

  it("본문을 고치면 서명이 맞지 않는다", async () => {
    const id = await submit(1);
    await tick();
    const [key] = await keysOf(id);
    const signed = await signFakeWebhook(
      SECRET,
      JSON.stringify({ events: [] }),
    );

    const { status } = await processSmsWebhook({
      provider,
      request: {
        ...signed,
        rawBody: JSON.stringify({ events: [event(key ?? "")] }),
      },
      supabase: service,
    });

    expect(status).toBe(401);
    expect((await messageOf(key ?? "")).status).toBe("sent");
  });

  it("형식이 틀리면 400이고 원문은 남는다", async () => {
    const rawBody = '{"events":[{"status":"unknown"}]}';
    const { status } = await processSmsWebhook({
      provider,
      request: await signFakeWebhook(SECRET, rawBody),
      supabase: service,
    });
    expect(status).toBe(400);
    const saved = await lastEvent();
    expect(saved.raw_body).toBe(rawBody);
    expect(saved.process_result).toBe("parse_error");
    expect(saved.error).not.toBeNull();
  });
});

describe("중복과 역순", () => {
  it("같은 웹훅이 두 번 와도 집계는 한 번이다", async () => {
    const id = await submit(2);
    await tick();
    const [key] = await keysOf(id);

    await post([event(key ?? "")]);
    await post([event(key ?? "")]);

    expect((await campaignOf(id)).delivered_count).toBe(1);
    expect((await lastEvent()).process_result).toBe("ignored_final");
  });

  it("도착 뒤 실패가 와도 최종 상태를 덮어쓰지 않는다", async () => {
    const id = await submit(2);
    await tick();
    const [key] = await keysOf(id);

    await post([event(key ?? "")]);
    await post([event(key ?? "", { status: "failed", failCode: "E1" })]);

    expect(await messageOf(key ?? "")).toMatchObject({
      status: "delivered",
      fail_code: null,
    });
    expect(await campaignOf(id)).toMatchObject({
      delivered_count: 1,
      failed_count: 0,
    });
  });

  it("웹훅이 워커의 저장보다 먼저 와도 결과가 같다", async () => {
    const id = await submit(1);
    let key = "";
    const racing: SmsProvider = {
      ...accepting,
      send: async (batch) => {
        key = batch[0]?.idempotencyKey ?? "";
        await post([event(key)]);
        return accepting.send(batch);
      },
    };

    await tick(racing);

    const message = await messageOf(key);
    expect(message.status).toBe("delivered");
    expect(message.sent_at).not.toBeNull();
    expect(message.provider).toBe("fake");
    expect(await campaignOf(id)).toMatchObject({
      status: "completed",
      sent_count: 1,
      delivered_count: 1,
    });
  });

  it("모르는 메시지는 200으로 받고 기록한다", async () => {
    // 5xx면 업체가 계속 다시 보내지만, 다시 받아도 찾을 수 없다.
    const { status } = await post([event(randomUUID())]);
    expect(status).toBe(200);
    expect((await lastEvent()).process_result).toBe("unknown_message");
  });

  it("다른 업체의 메시지는 고치지 않는다", async () => {
    const id = await submit(1);
    await tick();
    const [key] = await keysOf(id);
    must(
      await service
        .from("messages")
        .update({ provider: "solapi" })
        .eq("idempotency_key", key ?? "")
        .select("id"),
    );

    await post([event(key ?? "")]);

    expect((await messageOf(key ?? "")).status).toBe("sent");
    expect((await lastEvent()).process_result).toBe("provider_mismatch");
  });

  it("멱등 키가 없으면 업체 id로 찾는다", async () => {
    const id = await submit(1);
    await tick();
    const [key] = await keysOf(id);
    await processSmsWebhook({
      provider: {
        ...provider,
        parseWebhook: () => [
          {
            status: "delivered",
            providerMessageId: `fake-${key}`,
            idempotencyKey: null,
            occurredAt: new Date(),
          },
        ],
      },
      request: await signFakeWebhook(SECRET, "{}"),
      supabase: service,
    });

    expect((await messageOf(key ?? "")).status).toBe("delivered");
  });
});

describe("집계와 완료", () => {
  it("모두 확정되면 완료되고 실패분만 돌아온다", async () => {
    const start = await balance();
    const id = await submit(3, 10);
    expect(await balance()).toBe(start - 30);
    await tick();
    const [a, b, c] = await keysOf(id);

    await post([event(a ?? "")]);
    await post([event(b ?? "", { status: "failed", failCode: "E1" })]);
    expect((await campaignOf(id)).status).toBe("sending");
    expect(await balance()).toBe(start - 30);

    await post([event(c ?? "", { status: "failed", failCode: "E2" })]);

    const campaign = await campaignOf(id);
    expect(campaign).toMatchObject({
      status: "completed",
      sent_count: 3,
      delivered_count: 1,
      failed_count: 2,
    });
    expect(campaign.completed_at).not.toBeNull();
    expect(await balance()).toBe(start - 10);
    const release = must(
      await service
        .from("ledger_entries")
        .select("amount")
        .eq("campaign_id", id)
        .eq("kind", "release"),
    );
    expect(release).toEqual([{ amount: 20 }]);
  });

  it("모두 도착하면 환불 기록이 없다", async () => {
    const id = await submit(1);
    await tick();
    const [key] = await keysOf(id);
    await post([event(key ?? "")]);
    expect((await campaignOf(id)).status).toBe("completed");
    const release = must(
      await service
        .from("ledger_entries")
        .select("id")
        .eq("campaign_id", id)
        .eq("kind", "release"),
    );
    expect(release).toEqual([]);
  });

  it("보내기 전 영구 실패는 접수로 세지 않고, 전부 실패하면 전액 돌아온다", async () => {
    const start = await balance();
    const id = await submit(2, 10);

    await tick({
      ...accepting,
      send: async (batch) =>
        batch.map((request): SendResult => ({
          idempotencyKey: request.idempotencyKey,
          outcome: "rejected",
          failCode: "BAD",
          retryable: false,
        })),
    });

    expect(await campaignOf(id)).toMatchObject({
      status: "completed",
      sent_count: 0,
      failed_count: 2,
    });
    expect(await balance()).toBe(start);
  });

  it("웹훅이 동시에 몰려도 집계가 맞고 한 번만 정산한다", async () => {
    const start = await balance();
    const id = await submit(20, 10);
    await tick();
    const keys = await keysOf(id);

    const results = await Promise.all(
      keys.flatMap((key, index) => {
        const result: Result =
          index % 2 === 0
            ? { status: "delivered" }
            : { status: "failed", failCode: "E1" };
        // 중복까지 섞는다.
        return [post([event(key, result)]), post([event(key, result)])];
      }),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await campaignOf(id)).toMatchObject({
      status: "completed",
      delivered_count: 10,
      failed_count: 10,
    });
    expect(await balance()).toBe(start - 100);
  });

  it("한 웹훅에 여러 건이 와도 처리한다", async () => {
    const id = await submit(3);
    await tick();
    const keys = await keysOf(id);

    await post(keys.map((key) => event(key)));

    expect(await campaignOf(id)).toMatchObject({
      status: "completed",
      delivered_count: 3,
    });
  });

  it("complete_campaign은 조건이 맞을 때 한 번만 성공한다", async () => {
    const id = await submit(1);
    await tick();
    const early = await service.rpc("complete_campaign", { p_campaign_id: id });
    expect(early.data).toBe(false);

    const [key] = await keysOf(id);
    await post([event(key ?? "")]);
    const again = await service.rpc("complete_campaign", { p_campaign_id: id });
    expect(again.data).toBe(false);
  });
});
