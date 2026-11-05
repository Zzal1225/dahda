import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import {
  allowRecipients,
  createGuardedProvider,
} from "@/server/providers/guarded-provider";
import { createSolapiProvider } from "@/server/providers/solapi/solapi-provider";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { runWorkerTick } from "@/server/queue/worker";
import { processSmsWebhook } from "@/server/webhooks/process-sms-webhook";
import { createFixture, must, service, type Fixture } from "./fixture";

const SECRET = "solapi-secret";
const HEADERS = {
  "content-type": "application/json",
  "x-solapi-event-name": "SINGLE-REPORT",
  "x-solapi-secret": createHash("sha1").update(SECRET).digest("hex"),
};

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
  await service.from("messages").delete().eq("status", "queued");
  await service.from("real_send_counters").delete().gte("sent", 0);
});
afterAll(async () => {
  await f.cleanup();
  await service.from("real_send_counters").delete().gte("sent", 0);
});

const reserve = async (count: number, limit: number) =>
  must(
    await service.rpc("reserve_real_sends", {
      p_count: count,
      p_limit: limit,
    }),
  );

describe("reserve_real_sends", () => {
  it("상한까지만 내주고, 다 쓰면 0이다", async () => {
    await service.from("real_send_counters").delete().gte("sent", 0);
    expect(await reserve(3, 5)).toBe(3);
    expect(await reserve(3, 5)).toBe(2);
    expect(await reserve(1, 5)).toBe(0);
  });

  it("동시에 요청해도 상한을 넘지 않는다", async () => {
    await service.from("real_send_counters").delete().gte("sent", 0);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserve(1, 4)),
    );
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it("사용자는 부를 수 없고 표도 읽을 수 없다", async () => {
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
    const { error } = await client.rpc("reserve_real_sends", {
      p_count: 1,
      p_limit: 1,
    });
    expect(error?.code).toBe("42501");
    const read = await client.from("real_send_counters").select("day");
    expect(read.data ?? []).toEqual([]);
  });
});

describe("솔라피 어댑터 전체 경로", () => {
  it("접수 → 웹훅 → 완료. 허용 번호 밖은 업체에 가지 않고 환불된다", async () => {
    await service.from("real_send_counters").delete().gte("sent", 0);
    const before = must(
      await service
        .from("account_balances")
        .select("balance")
        .eq("branch_id", f.branch1)
        .single(),
    ).balance;
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
          { phone: "01011112222", name: null },
          { phone: "01033334444", name: null },
        ],
      }),
    );

    const sentTo: string[] = [];
    const solapi = createGuardedProvider(
      createSolapiProvider({
        webhookSecret: SECRET,
        client: {
          send: async (messages) => {
            sentTo.push(...messages.map((message) => message.to));
            return {
              messageList: messages.map((message) => ({
                messageId: `S-${message.customFields.k}`,
                statusCode: "2000",
                customFields: message.customFields,
              })),
              failedMessageList: [],
            };
          },
        },
      }),
      {
        isAllowed: allowRecipients(new Set(["01011112222"])),
        dailyLimit: 10,
        reserve,
      },
    );

    await runWorkerTick({
      store: createSupabaseQueueStore(service),
      providerFor: () => solapi,
      batchSize: 1000,
      leaseSeconds: 300,
    });

    expect(sentTo).toEqual(["01011112222"]);
    const rows = must(
      await service
        .from("messages")
        .select(
          "phone, status, fail_code, provider, provider_message_id, idempotency_key",
        )
        .eq("campaign_id", id)
        .order("phone"),
    );
    expect(rows[0]).toMatchObject({ status: "sent", provider: "solapi" });
    expect(rows[1]).toMatchObject({
      status: "failed",
      fail_code: "BLOCKED_RECIPIENT",
    });

    // 진행 중 코드는 상태를 바꾸지 않는다.
    const key = rows[0]?.idempotency_key;
    const providerId = rows[0]?.provider_message_id;
    const post = (statusCode: string) =>
      processSmsWebhook({
        provider: createSolapiProvider({ webhookSecret: SECRET }),
        request: {
          rawBody: JSON.stringify([
            {
              messageId: providerId,
              statusCode,
              customFields: { k: key },
              dateReceived: new Date().toISOString(),
            },
          ]),
          headers: new Headers(HEADERS),
        },
        supabase: service,
      });
    expect((await post("3000")).status).toBe(200);
    const pending = must(
      await service.from("campaigns").select("status").eq("id", id).single(),
    );
    expect(pending.status).toBe("sending");

    expect((await post("4000")).status).toBe(200);

    expect(
      must(
        await service
          .from("campaigns")
          .select("status, delivered_count, failed_count")
          .eq("id", id)
          .single(),
      ),
    ).toEqual({ status: "completed", delivered_count: 1, failed_count: 1 });
    const after = must(
      await service
        .from("account_balances")
        .select("balance")
        .eq("branch_id", f.branch1)
        .single(),
    ).balance;
    expect(after).toBe((before ?? 0) - 10);
  });
});
