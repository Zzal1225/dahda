import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_SAMPLE_CAMPAIGN_ID } from "@/features/messages/public-sample";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

const ORG = "5a3b1e00-0000-4000-8000-000000000001";
let f: Fixture;

const asUser = async (key: Parameters<Fixture["tokenOf"]>[0]) =>
  createClient<Database>(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${await f.tokenOf(key)}` } },
    },
  );

beforeAll(async () => {
  f = await createFixture();
  must(await service.rpc("seed_public_sample"));
}, 120_000);
afterAll(async () => {
  await f.cleanup();
  // 뒤 파일의 테스트와 CI 시간에 영향을 주지 않게 지운다.
  await service.from("organizations").delete().eq("id", ORG);
});

describe("공용 샘플", () => {
  it("10만 행을 만들고 집계가 행과 맞는다", async () => {
    const campaign = must(
      await service
        .from("campaigns")
        .select(
          "org_id, status, recipient_count, sent_count, delivered_count, failed_count",
        )
        .eq("id", PUBLIC_SAMPLE_CAMPAIGN_ID)
        .single(),
    );
    expect(campaign.org_id).toBe(ORG);
    expect(campaign.recipient_count).toBe(100_000);
    expect(campaign.sent_count).toBe(100_000);

    const count = async (status: "delivered" | "failed") =>
      (
        await service
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", PUBLIC_SAMPLE_CAMPAIGN_ID)
          .eq("status", status)
      ).count;
    expect(await count("delivered")).toBe(campaign.delivered_count);
    expect(await count("failed")).toBe(campaign.failed_count);
  });

  it("대기 행이 없어 워커가 발송하지 않고, 보정 대상도 아니다", async () => {
    const queued = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", PUBLIC_SAMPLE_CAMPAIGN_ID)
      .eq("status", "queued");
    expect(queued.count).toBe(0);

    const solapi = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", PUBLIC_SAMPLE_CAMPAIGN_ID)
      .eq("provider", "solapi");
    expect(solapi.count).toBe(0);
  });

  it("잔액 기록을 만들지 않는다", async () => {
    const { count } = await service
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ORG);
    expect(count).toBe(0);
  });

  it.each(["hq", "branch1"] as const)(
    "%s 사용자는 RLS로 샘플을 읽지 못해 자기 숫자에 섞이지 않는다",
    async (key) => {
      const client = await asUser(key);
      const campaigns = must(
        await client
          .from("campaigns")
          .select("id")
          .eq("id", PUBLIC_SAMPLE_CAMPAIGN_ID),
      );
      expect(campaigns).toEqual([]);
      const messages = must(
        await client
          .from("messages")
          .select("id")
          .eq("campaign_id", PUBLIC_SAMPLE_CAMPAIGN_ID)
          .limit(1),
      );
      expect(messages).toEqual([]);
    },
  );

  it("사용자는 시드 함수를 부를 수 없다", async () => {
    const { error } = await (await asUser("hq")).rpc("seed_public_sample");
    expect(error?.code).toBe("42501");
  });

  it("다른 본사 이름으로 재발송할 수 없다", async () => {
    const preview = must(
      await service.rpc("preview_retry", {
        p_source_id: PUBLIC_SAMPLE_CAMPAIGN_ID,
        p_org_id: f.orgA,
        p_message_ids: [1],
        p_hopeless_codes: [],
      }),
    );
    expect(preview[0]?.target_count ?? 0).toBe(0);
  });

  it("다시 실행해도 같은 구성이다", async () => {
    expect(must(await service.rpc("seed_public_sample"))).toBe(100_000);
    const { count } = await service
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ORG);
    expect(count).toBe(1);
  }, 120_000);
});
