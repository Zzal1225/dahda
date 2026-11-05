import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendResult, SmsProvider } from "@/server/providers/sms-provider";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { runWorkerTick } from "@/server/queue/worker";
import { createFixture, must, service, type Fixture } from "./fixture";

let f: Fixture;
const store = createSupabaseQueueStore(service);
const LEASE = 300;
const LIMIT = 1000;

beforeAll(async () => {
  f = await createFixture();
  // 다른 테스트가 남긴 대기 행이 묶음에 섞이지 않게 비운다.
  await service.from("messages").delete().eq("status", "queued");
});
afterAll(async () => {
  await f.cleanup();
});

async function submit(options: {
  status?: "scheduled" | "pending_approval";
  scheduledAt?: string | null;
  isAd?: boolean;
  count?: number;
}) {
  const status = options.status ?? "scheduled";
  return must(
    await service.rpc("submit_campaign", {
      p_client_request_id: randomUUID(),
      p_org_id: f.orgA,
      p_branch_id: f.branch1,
      p_created_by: f.users.branch1.id,
      p_body: "본문",
      p_kind: "sms",
      p_is_ad: options.isAd ?? false,
      p_sender_phone: "0212345678",
      p_status: status,
      p_scheduled_at: (options.scheduledAt ?? null) as string,
      p_unit_price: 1,
      p_recipients: Array.from({ length: options.count ?? 2 }, (_, index) => ({
        phone: `0100000${String(6000 + index).padStart(4, "0")}`,
        name: null,
      })),
    }),
  );
}

const messagesOf = async (campaignId: string) =>
  must(
    await service
      .from("messages")
      .select(
        "id, status, provider, provider_message_id, fail_code, attempt_count, next_attempt_at, sent_at, finalized_at",
      )
      .eq("campaign_id", campaignId)
      .order("id"),
  );

const claim = (limit = LIMIT) => store.claim(limit, LEASE);
const idsOf = (rows: readonly { id: number }[]) => rows.map((row) => row.id);

function provider(
  result: (key: string) => Omit<SendResult, "idempotencyKey"> = (key) => ({
    outcome: "accepted",
    providerMessageId: `p-${key}`,
  }),
): SmsProvider {
  return {
    name: "fake",
    send: async (batch) =>
      batch.map(
        (request) =>
          ({
            idempotencyKey: request.idempotencyKey,
            ...result(request.idempotencyKey),
          }) as SendResult,
      ),
    parseWebhook: () => [],
    verifySignature: async () => true,
  };
}

const tick = (sms = provider(), now?: () => Date) =>
  runWorkerTick({
    store,
    providerFor: () => sms,
    batchSize: LIMIT,
    leaseSeconds: LEASE,
    now,
  });

describe("claim_messages", () => {
  it("보낼 시각이 된 행을 집고 임대한다", async () => {
    const id = await submit({});
    const before = await messagesOf(id);

    const claimed = await claim();

    const after = await messagesOf(id);
    expect(idsOf(claimed)).toEqual(expect.arrayContaining(idsOf(before)));
    expect(after[0]?.attempt_count).toBe(1);
    expect(new Date(after[0]?.next_attempt_at ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 200_000,
    );
    expect(claimed.find((row) => row.campaignId === id)).toMatchObject({
      campaignStatus: "scheduled",
      senderPhone: "0212345678",
      isTrial: false,
    });
  });

  it("임대 중에는 다시 집지 않는다", async () => {
    const id = await submit({});
    await claim();
    const again = await claim();
    expect(again.some((row) => row.campaignId === id)).toBe(false);
  });

  it("동시에 집어도 같은 행을 두 번 받지 않는다", async () => {
    await submit({ count: 40 });

    const results = await Promise.all([claim(15), claim(15), claim(15)]);

    const ids = results.flatMap(idsOf);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("승인 대기 광고는 시각이 지나도 집지 않는다", async () => {
    const id = await submit({ status: "pending_approval", isAd: true });
    const claimed = await claim();
    expect(claimed.some((row) => row.campaignId === id)).toBe(false);
    expect((await messagesOf(id))[0]?.attempt_count).toBe(0);
  });

  it("승인하면 집힌다", async () => {
    const id = await submit({ status: "pending_approval", isAd: true });
    const { error } = await service.rpc("approve_campaign", {
      p_campaign_id: id,
      p_org_id: f.orgA,
      p_reviewer: f.users.hq.id,
    });
    expect(error).toBeNull();
    const claimed = await claim();
    expect(claimed.some((row) => row.campaignId === id)).toBe(true);
  });

  it("예약 시각 전에는 집지 않는다", async () => {
    const id = await submit({ scheduledAt: "2030-01-01T01:00:00Z" });
    const claimed = await claim();
    expect(claimed.some((row) => row.campaignId === id)).toBe(false);
  });

  it("다른 상태의 발송 건은 집지 않는다", async () => {
    const id = await submit({});
    must(
      await service
        .from("campaigns")
        .update({ status: "canceled" })
        .eq("id", id)
        .select("id"),
    );
    const claimed = await claim();
    expect(claimed.some((row) => row.campaignId === id)).toBe(false);
  });
});

describe("runWorkerTick", () => {
  it("보내면 메시지는 sent, 발송 건은 sending이 된다", async () => {
    const id = await submit({});

    await tick();

    const rows = await messagesOf(id);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect(rows[0]?.provider).toBe("fake");
    expect(rows[0]?.provider_message_id).toMatch(/^p-/);
    expect(rows[0]?.sent_at).not.toBeNull();
    const campaign = must(
      await service
        .from("campaigns")
        .select("status, started_at")
        .eq("id", id)
        .single(),
    );
    expect(campaign.status).toBe("sending");
    expect(campaign.started_at).not.toBeNull();
  });

  it("다음 묶음이 시작 시각을 덮어쓰지 않는다", async () => {
    const id = await submit({ count: 3 });
    await tick(
      provider(() => ({ outcome: "rejected", failCode: "E", retryable: true })),
    );
    const first = must(
      await service
        .from("campaigns")
        .select("started_at")
        .eq("id", id)
        .single(),
    );
    must(
      await service
        .from("messages")
        .update({ next_attempt_at: new Date(0).toISOString() })
        .eq("campaign_id", id)
        .select("id"),
    );

    await tick();

    const second = must(
      await service
        .from("campaigns")
        .select("started_at")
        .eq("id", id)
        .single(),
    );
    expect(second.started_at).toBe(first.started_at);
  });

  it("일시 오류 뒤 1분 후로 미루고 같은 멱등 키로 다시 보낸다", async () => {
    const id = await submit({ count: 1 });
    const key = must(
      await service
        .from("messages")
        .select("idempotency_key")
        .eq("campaign_id", id)
        .single(),
    ).idempotency_key;
    const seen: string[] = [];
    const down = provider((k) => {
      seen.push(k);
      return { outcome: "rejected", failCode: "E503", retryable: true };
    });

    await tick(down);

    const row = (await messagesOf(id))[0];
    expect(row?.status).toBe("queued");
    expect(row?.attempt_count).toBe(1);
    const wait = new Date(row?.next_attempt_at ?? 0).getTime() - Date.now();
    expect(wait).toBeGreaterThan(50_000);
    expect(wait).toBeLessThanOrEqual(60_000);

    must(
      await service
        .from("messages")
        .update({ next_attempt_at: new Date(0).toISOString() })
        .eq("campaign_id", id)
        .select("id"),
    );
    await tick(down);
    expect(seen).toEqual([key, key]);
    expect((await messagesOf(id))[0]?.attempt_count).toBe(2);
  });

  it("영구 오류는 바로 실패로 확정한다", async () => {
    const id = await submit({ count: 1 });
    await tick(
      provider(() => ({
        outcome: "rejected",
        failCode: "BAD",
        retryable: false,
      })),
    );
    const row = (await messagesOf(id))[0];
    expect(row).toMatchObject({ status: "failed", fail_code: "BAD" });
    expect(row?.finalized_at).not.toBeNull();
  });

  it("야간 광고는 8시로 미루고 시도 횟수를 그대로 둔다", async () => {
    const id = await submit({ isAd: true, count: 1 });
    const summary = await tick(
      provider(),
      () => new Date("2026-11-04T13:00:00Z"),
    );
    expect(summary.deferred).toBeGreaterThan(0);
    const row = (await messagesOf(id))[0];
    expect(row).toMatchObject({ status: "queued", attempt_count: 0 });
    expect(new Date(row?.next_attempt_at ?? 0).toISOString()).toBe(
      "2026-11-04T23:00:00.000Z",
    );
    // 고정 시각 기준의 8시는 실제 시간으로 이미 지난 과거다. 남기면 다음 테스트가 이 행을 집는다.
    must(
      await service
        .from("messages")
        .delete()
        .eq("campaign_id", id)
        .select("id"),
    );
  });

  it("웹훅이 저장보다 먼저 와도 최종 상태를 되돌리지 않는다", async () => {
    const id = await submit({ count: 1 });
    const racing: SmsProvider = {
      ...provider(),
      send: async (batch) => {
        // 업체 호출 중에 웹훅이 먼저 처리된 상황을 만든다.
        must(
          await service
            .from("messages")
            .update({
              status: "delivered",
              provider: "fake",
              provider_message_id: `p-${batch[0]?.idempotencyKey}`,
              finalized_at: new Date().toISOString(),
            })
            .eq("idempotency_key", batch[0]?.idempotencyKey ?? "")
            .select("id"),
        );
        return provider().send(batch);
      },
    };

    await tick(racing);

    const row = (await messagesOf(id))[0];
    expect(row?.status).toBe("delivered");
    expect(row?.sent_at).not.toBeNull();
  });
});

describe("권한과 예약", () => {
  it.each([
    ["claim_messages", { p_limit: 1, p_lease_seconds: 1 }],
    ["apply_message_updates", { p_updates: [] }],
  ] as const)("사용자는 %s를 부를 수 없다", async (name, args) => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${await f.tokenOf("hq")}` },
        },
      },
    );
    const { error } = await client.rpc(name, args);
    expect(error?.code).toBe("42501");
  });
});
