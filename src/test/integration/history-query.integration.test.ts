import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaignQuerySchema,
  listCampaigns,
} from "@/features/campaigns/campaign-query";
import {
  listMessages,
  messageQuerySchema,
  type MessageQuery,
} from "@/features/messages/message-query";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

let f: Fixture;
let campaignId: string;

const asUser = async (user: "hq" | "branch1" | "branch2" | "otherHq") => {
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

const query = (overrides: Partial<MessageQuery> = {}) =>
  messageQuerySchema.parse({ campaignId, ...overrides });

beforeAll(async () => {
  f = await createFixture();
  campaignId = must(
    await service
      .from("campaigns")
      .insert({
        org_id: f.orgA,
        branch_id: f.branch1,
        body: "조회 테스트",
        status: "sending",
        sender_phone: "0212345678",
        recipient_count: 5,
        unit_price: 20,
        estimated_cost: 100,
      })
      .select("id")
      .single(),
  ).id;

  must(
    await service
      .from("messages")
      .insert([
        {
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: "01000000011",
          status: "delivered",
          provider: "fake",
          provider_message_id: `q-${campaignId}-1`,
          sent_at: "2026-11-01T00:00:01Z",
          finalized_at: "2026-11-01T00:00:09Z",
        },
        {
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: "01000000012",
          status: "failed",
          fail_code: "E301",
          provider: "fake",
          provider_message_id: `q-${campaignId}-2`,
          sent_at: "2026-11-01T00:00:03Z",
          finalized_at: "2026-11-01T00:00:05Z",
        },
        {
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: "01000000021",
          status: "sent",
          provider: "fake",
          provider_message_id: `q-${campaignId}-3`,
          sent_at: "2026-11-01T00:00:02Z",
        },
        // 같은 접수 시각: 페이지 경계에서 순서가 흔들리지 않는지 본다.
        {
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: "01000000031",
          status: "sent",
          provider: "fake",
          provider_message_id: `q-${campaignId}-4`,
          sent_at: "2026-11-01T00:00:02Z",
        },
        // 접수 전: 시각이 없는 행은 어느 방향으로 정렬해도 뒤다.
        {
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: "01000000041",
          status: "queued",
        },
      ])
      .select("id"),
  );
});

afterAll(async () => {
  await f.cleanup();
});

describe("listMessages", () => {
  it("접수 시각 내림차순이 기본이고 시각 없는 행은 뒤로 간다", async () => {
    const { rows } = await listMessages(await asUser("hq"), query());
    expect(rows.map((row) => row.phone)).toEqual([
      "01000000012",
      "01000000021",
      "01000000031",
      "01000000011",
      "01000000041",
    ]);
  });

  it("오름차순에서도 시각 없는 행은 뒤로 간다", async () => {
    const { rows } = await listMessages(
      await asUser("hq"),
      query({ desc: false }),
    );
    expect(rows[0]?.phone).toBe("01000000011");
    expect(rows.at(-1)?.phone).toBe("01000000041");
  });

  it("확정 시각으로 정렬할 수 있다", async () => {
    const { rows } = await listMessages(
      await asUser("hq"),
      query({ sort: "finalized_at" }),
    );
    expect(rows.slice(0, 2).map((row) => row.phone)).toEqual([
      "01000000011",
      "01000000012",
    ]);
  });

  it("페이지를 나눠 받아도 같은 시각의 행이 겹치거나 빠지지 않는다", async () => {
    const client = await asUser("hq");
    const pages = [];
    for (let offset = 0; offset < 5; offset += 2) {
      const { rows } = await listMessages(client, query({ offset, limit: 2 }));
      pages.push(...rows.map((row) => row.id));
    }
    expect(new Set(pages).size).toBe(5);
  });

  it("상태를 여러 개 고를 수 있고 전체 건수도 조건을 따른다", async () => {
    const { rows, total } = await listMessages(
      await asUser("hq"),
      query({ status: ["failed", "queued"], withTotal: true }),
    );
    expect(rows.map((row) => row.status).sort()).toEqual(["failed", "queued"]);
    expect(total).toBe(2);
  });

  it("번호는 앞부분이 일치해야 찾는다", async () => {
    const client = await asUser("hq");
    const prefix = await listMessages(client, query({ q: "0100000002" }));
    const middle = await listMessages(client, query({ q: "00000002" }));

    expect(prefix.rows.map((row) => row.phone)).toEqual(["01000000021"]);
    expect(middle.rows).toEqual([]);
  });

  it("전체 건수는 요청할 때만 센다", async () => {
    const { total } = await listMessages(await asUser("hq"), query());
    expect(total).toBeNull();
  });

  it("담당 지점은 볼 수 있다", async () => {
    const { rows } = await listMessages(await asUser("branch1"), query());
    expect(rows).toHaveLength(5);
  });

  it.each(["branch2", "otherHq"] as const)(
    "%s는 id를 알아도 다른 범위의 메시지를 볼 수 없다",
    async (user) => {
      const { rows, total } = await listMessages(
        await asUser(user),
        query({ withTotal: true }),
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    },
  );
});

describe("listCampaigns", () => {
  const campaignQuery = (input: object = {}) =>
    campaignQuerySchema.parse(input);

  it("본사는 전 지점과 본사 발송을, 지점 이름과 함께 본다", async () => {
    const rows = await listCampaigns(await asUser("hq"), campaignQuery());
    const branchNames = new Set(rows.map((row) => row.branchName));
    expect(branchNames).toEqual(new Set(["성수점", "망원점", null]));
  });

  it("본사 발송만, 또는 지점 하나만 고를 수 있다", async () => {
    const client = await asUser("hq");
    const hqOnly = await listCampaigns(client, campaignQuery({ branch: "hq" }));
    const one = await listCampaigns(
      client,
      campaignQuery({ branch: f.branch2 }),
    );

    expect(hqOnly.every((row) => row.branchId === null)).toBe(true);
    expect(hqOnly.length).toBeGreaterThan(0);
    expect(one.every((row) => row.branchId === f.branch2)).toBe(true);
    expect(one.length).toBeGreaterThan(0);
  });

  it("지점 사용자가 다른 지점으로 필터해도 빈 결과다", async () => {
    const rows = await listCampaigns(
      await asUser("branch1"),
      campaignQuery({ branch: f.branch2 }),
    );
    expect(rows).toEqual([]);
  });

  it("타사 지점 id로 필터해도 빈 결과다", async () => {
    const rows = await listCampaigns(
      await asUser("hq"),
      campaignQuery({ branch: f.branchB }),
    );
    expect(rows).toEqual([]);
  });

  it("기간 범위 밖은 빠진다", async () => {
    const rows = await listCampaigns(
      await asUser("hq"),
      campaignQuery({
        from: "2000-01-01T00:00:00Z",
        to: "2000-01-02T00:00:00Z",
      }),
    );
    expect(rows).toEqual([]);
  });

  it("광고 여부로 거른다", async () => {
    const client = await asUser("hq");
    const ads = await listCampaigns(client, campaignQuery({ ad: "ad" }));
    const nonAds = await listCampaigns(client, campaignQuery({ ad: "non_ad" }));

    expect(ads).toEqual([]);
    expect(nonAds.length).toBeGreaterThan(0);
  });

  it("문자 종류로 거르고, 두 종류를 합치면 전체와 같다", async () => {
    const client = await asUser("hq");
    const all = await listCampaigns(client, campaignQuery());
    const sms = await listCampaigns(client, campaignQuery({ kind: "sms" }));
    const lms = await listCampaigns(client, campaignQuery({ kind: "lms" }));

    expect(sms.every((row) => row.kind === "sms")).toBe(true);
    expect(lms.every((row) => row.kind === "lms")).toBe(true);
    expect(sms.length + lms.length).toBe(all.length);
  });

  it("작성 중인 건은 내역에 나오지 않는다", async () => {
    const draft = must(
      await service
        .from("campaigns")
        .insert({ org_id: f.orgA, branch_id: f.branch1, body: "작성 중" })
        .select("id")
        .single(),
    );
    const rows = await listCampaigns(await asUser("hq"), campaignQuery());
    expect(rows.some((row) => row.id === draft.id)).toBe(false);
  });
});
