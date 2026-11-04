import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import type { SendResult, SmsProvider } from "@/server/providers/sms-provider";
import { createFakeProvider } from "@/server/providers/fake/fake-provider";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { runWorkerTick } from "@/server/queue/worker";
import { createFixture, must, service, type Fixture } from "./fixture";

const INSUFFICIENT = "DH004";
const NO_RECIPIENTS = "DH008";
const NOT_RETRYABLE = "DH013";
const HOPELESS = ["E301"];

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
  await service.from("messages").delete().eq("status", "queued");
});
afterAll(async () => {
  await f.cleanup();
});

const rejecting: SmsProvider = {
  ...createFakeProvider({
    secret: "x",
    deliver: async () => {},
    onDeliveryError: () => {},
  }),
  send: async (batch) =>
    batch.map((request): SendResult => ({
      idempotencyKey: request.idempotencyKey,
      outcome: "rejected",
      failCode: "E301",
      retryable: false,
    })),
};

let nextPhone = 8000;

/** 모든 수신자가 실패하고 완료된 발송 건. 실패분이 환불돼 잔액이 원래대로 돌아온 상태다. */
async function failedCampaign(count: number, branch = f.branch1) {
  const id = must(
    await service.rpc("submit_campaign", {
      p_client_request_id: randomUUID(),
      p_org_id: f.orgA,
      p_branch_id: branch,
      p_created_by: f.users.branch1.id,
      p_body: "본문",
      p_kind: "sms",
      p_is_ad: false,
      p_sender_phone: "0212345678",
      p_status: "scheduled",
      p_scheduled_at: null as unknown as string,
      p_unit_price: 10,
      p_recipients: Array.from({ length: count }, () => ({
        phone: `0100000${String((nextPhone += 1)).padStart(4, "0")}`,
        name: "손님",
      })),
    }),
  );
  await runWorkerTick({
    store: createSupabaseQueueStore(service),
    providerFor: () => rejecting,
    batchSize: 1000,
    leaseSeconds: 300,
  });
  return id;
}

const messagesOf = async (id: string) =>
  must(
    await service
      .from("messages")
      .select("id, phone, status, recipient_name")
      .eq("campaign_id", id)
      .order("id"),
  );
const idsOf = async (id: string) =>
  (await messagesOf(id)).map((message) => message.id);
const balance = async (branch = f.branch1) =>
  must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", branch)
      .single(),
  ).balance ?? 0;

const retry = (source: string, ids: number[], org = f.orgA) =>
  service.rpc("retry_failed_messages", {
    p_source_id: source,
    p_org_id: org,
    p_created_by: f.users.hq.id,
    p_message_ids: ids,
  });
const preview = async (source: string, ids: number[]) =>
  must(
    await service.rpc("preview_retry", {
      p_source_id: source,
      p_org_id: f.orgA,
      p_message_ids: ids,
      p_hopeless_codes: HOPELESS,
    }),
  )[0];

describe("retry_failed_messages", () => {
  it("실패 건으로 새 발송 건을 만들고 원본은 바꾸지 않는다", async () => {
    const source = await failedCampaign(3);
    const before = await balance();
    const originals = await messagesOf(source);
    const sourceBefore = must(
      await service.from("campaigns").select("*").eq("id", source).single(),
    );

    const newId = must(
      await retry(
        source,
        originals.map((m) => m.id),
      ),
    );

    const created = must(
      await service.from("campaigns").select("*").eq("id", newId).single(),
    );
    expect(created).toMatchObject({
      retry_of_campaign_id: source,
      status: "scheduled",
      recipient_count: 3,
      unit_price: 10,
      estimated_cost: 30,
      body: "본문",
      branch_id: f.branch1,
    });
    const copied = await messagesOf(newId);
    expect(copied.map((m) => m.phone)).toEqual(originals.map((m) => m.phone));
    expect(copied.every((m) => m.status === "queued")).toBe(true);
    expect(copied[0]?.recipient_name).toBe("손님");

    expect(await balance()).toBe(before - 30);
    expect(await messagesOf(source)).toEqual(originals);
    expect(
      must(
        await service.from("campaigns").select("*").eq("id", source).single(),
      ),
    ).toEqual(sourceBefore);
  });

  it("선택한 행만 보낸다", async () => {
    const source = await failedCampaign(3);
    const [first] = await idsOf(source);
    const newId = must(await retry(source, [first ?? 0]));
    expect((await messagesOf(newId)).length).toBe(1);
  });

  it("실패하지 않은 행은 빠진다", async () => {
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
          { phone: "01000009001", name: null },
          { phone: "01000009002", name: null },
        ],
      }),
    );
    // 한 건은 접수되고 한 건은 실패한, 발송 중인 건을 만든다. 워커는 발송기 객체별로 묶으므로 같은 객체를 쓴다.
    const mixed: SmsProvider = {
      ...rejecting,
      send: async (batch) =>
        batch.map((request): SendResult =>
          // 앞선 테스트의 대기 행이 묶음에 섞이므로 순서가 아니라 번호로 고른다.
          request.to === "01000009001"
            ? {
                idempotencyKey: request.idempotencyKey,
                outcome: "rejected",
                failCode: "E301",
                retryable: false,
              }
            : {
                idempotencyKey: request.idempotencyKey,
                outcome: "accepted",
                providerMessageId: `p-${request.idempotencyKey}`,
              },
        ),
    };
    await runWorkerTick({
      store: createSupabaseQueueStore(service),
      providerFor: () => mixed,
      batchSize: 1000,
      leaseSeconds: 300,
    });

    const newId = must(await retry(id, await idsOf(id)));

    expect((await messagesOf(newId)).map((m) => m.phone)).toEqual([
      "01000009001",
    ]);
  });

  it("다른 발송 건의 행은 끼워 넣어도 빠진다", async () => {
    const source = await failedCampaign(1);
    const other = await failedCampaign(1);
    const newId = must(
      await retry(source, [...(await idsOf(source)), ...(await idsOf(other))]),
    );
    expect((await messagesOf(newId)).length).toBe(1);
  });

  it("두 번 눌러도 한 번만 보내고 한 번만 차감한다", async () => {
    const source = await failedCampaign(2);
    const ids = await idsOf(source);
    const before = await balance();

    must(await retry(source, ids));
    const { error } = await retry(source, ids);

    expect(error?.code).toBe(NO_RECIPIENTS);
    expect(await balance()).toBe(before - 20);
  });

  it("동시에 눌러도 하나만 성공한다", async () => {
    const source = await failedCampaign(2);
    const ids = await idsOf(source);
    const before = await balance();

    const results = await Promise.all([
      retry(source, ids),
      retry(source, ids),
      retry(source, ids),
    ]);

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(await balance()).toBe(before - 20);
  });

  it("재발송을 취소하면 다시 보낼 수 있다", async () => {
    const source = await failedCampaign(1);
    const ids = await idsOf(source);
    const first = must(await retry(source, ids));
    must(
      await service
        .from("campaigns")
        .update({ status: "canceled" })
        .eq("id", first)
        .select("id"),
    );
    expect((await retry(source, ids)).error).toBeNull();
  });

  it("수신거부한 번호는 빠진다", async () => {
    const source = await failedCampaign(2);
    const messages = await messagesOf(source);
    must(
      await service
        .from("opt_outs")
        .insert({
          org_id: f.orgA,
          phone: messages[0]?.phone ?? "",
          source: "manual",
        })
        .select("id"),
    );

    const newId = must(
      await retry(
        source,
        messages.map((m) => m.id),
      ),
    );

    expect((await messagesOf(newId)).map((m) => m.phone)).toEqual([
      messages[1]?.phone,
    ]);
  });

  it("보낼 대상이 없으면 거부한다", async () => {
    const source = await failedCampaign(1);
    expect((await retry(source, [])).error?.code).toBe(NO_RECIPIENTS);
  });

  it("잔액이 부족하면 아무것도 만들지 않는다", async () => {
    const source = must(
      await service.rpc("submit_campaign", {
        p_client_request_id: randomUUID(),
        p_org_id: f.orgA,
        p_branch_id: f.branch1,
        p_created_by: f.users.branch1.id,
        p_body: "비싼 본문",
        p_kind: "sms",
        p_is_ad: false,
        p_sender_phone: "0212345678",
        p_status: "scheduled",
        p_scheduled_at: null as unknown as string,
        p_unit_price: 1,
        p_recipients: [{ phone: "01000009999", name: null }],
      }),
    );
    await runWorkerTick({
      store: createSupabaseQueueStore(service),
      providerFor: () => rejecting,
      batchSize: 1000,
      leaseSeconds: 300,
    });
    // 원본 단가를 잔액보다 크게 만든다. 집계 제약 때문에 수신자 수도 맞춘다.
    must(
      await service
        .from("campaigns")
        .update({ unit_price: 100_000_000, estimated_cost: 100_000_000 })
        .eq("id", source)
        .select("id"),
    );

    const { error } = await retry(source, await idsOf(source));

    expect(error?.code).toBe(INSUFFICIENT);
    const children = must(
      await service
        .from("campaigns")
        .select("id")
        .eq("retry_of_campaign_id", source),
    );
    expect(children).toEqual([]);
  });

  it("다른 본사의 발송 건은 다시 보낼 수 없다", async () => {
    const source = await failedCampaign(1);
    const { error } = await retry(source, await idsOf(source), f.orgB);
    expect(error?.code).toBe(NOT_RETRYABLE);
  });

  it("보내기 전 상태의 발송 건은 다시 보낼 수 없다", async () => {
    const source = must(
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
        p_scheduled_at: "2030-01-01T00:00:00Z",
        p_unit_price: 1,
        p_recipients: [{ phone: "01000009998", name: null }],
      }),
    );
    expect((await retry(source, await idsOf(source))).error?.code).toBe(
      NOT_RETRYABLE,
    );
  });
});

describe("preview_retry", () => {
  it("실행과 같은 대상을 센다", async () => {
    const source = await failedCampaign(3);
    const messages = await messagesOf(source);
    const ids = messages.map((m) => m.id);
    must(
      await service
        .from("opt_outs")
        .insert({
          org_id: f.orgA,
          phone: messages[0]?.phone ?? "",
          source: "manual",
        })
        .select("id"),
    );

    const row = await preview(source, ids);

    expect(row).toMatchObject({
      failed_count: 3,
      target_count: 2,
      hopeless_count: 2,
      unit_price: 10,
      kind: "sms",
      balance: await balance(),
    });
    const newId = must(await retry(source, ids));
    expect((await messagesOf(newId)).length).toBe(row?.target_count);
  });

  it("이미 재발송한 건은 대상에서 빠진다", async () => {
    const source = await failedCampaign(1);
    const ids = await idsOf(source);
    must(await retry(source, ids));
    expect(await preview(source, ids)).toMatchObject({
      failed_count: 1,
      target_count: 0,
    });
  });
});

describe("실행 권한과 구독", () => {
  it.each([
    [
      "retry_failed_messages",
      {
        p_source_id: randomUUID(),
        p_org_id: randomUUID(),
        p_created_by: randomUUID(),
        p_message_ids: [],
      },
    ],
    [
      "preview_retry",
      {
        p_source_id: randomUUID(),
        p_org_id: randomUUID(),
        p_message_ids: [],
        p_hopeless_codes: [],
      },
    ],
  ] as const)("사용자는 %s를 부를 수 없다", async (name, args) => {
    const client = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${await f.tokenOf("hq")}` },
        },
      },
    );
    const { error } = await client.rpc(name, args as never);
    expect(error?.code).toBe("42501");
  });
});
