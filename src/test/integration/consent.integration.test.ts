import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRecipients } from "@/features/campaigns/recipients";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

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

const uniquePhone = () =>
  `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function contact(
  branchId: string,
  consented: boolean,
  phone = uniquePhone(),
) {
  const row = must(
    await service
      .from("contacts")
      .insert({
        org_id: f.orgA,
        branch_id: branchId,
        phone,
        consent_at: consented ? new Date().toISOString() : null,
      })
      .select("id, phone")
      .single(),
  );
  return row;
}

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await f.cleanup();
});

describe("광고 수신 동의", () => {
  it("광고는 미동의 번호를 빼고 센다", async () => {
    const yes = await contact(f.branch1, true);
    const no = await contact(f.branch1, false);
    const result = await resolveRecipients(
      await asUser("branch1"),
      [],
      [yes.id, no.id],
      { isAd: true },
    );
    expect(result.recipients.map((r) => r.phone)).toEqual([yes.phone]);
    expect(result.noConsent).toBe(1);
  });

  it("일반 문자는 동의를 보지 않는다", async () => {
    const no = await contact(f.branch1, false);
    const result = await resolveRecipients(
      await asUser("branch1"),
      [],
      [no.id],
      { isAd: false },
    );
    expect(result.recipients).toHaveLength(1);
    expect(result.noConsent).toBe(0);
  });

  it("수신거부는 동의가 있어도 빠지고 미동의로 세지 않는다", async () => {
    const row = await contact(f.branch1, true);
    must(
      await service
        .from("opt_outs")
        .insert({ org_id: f.orgA, phone: row.phone, source: "manual" })
        .select("id"),
    );
    const result = await resolveRecipients(
      await asUser("branch1"),
      [],
      [row.id],
      { isAd: true },
    );
    expect(result).toMatchObject({ optedOut: 1, noConsent: 0, recipients: [] });
  });

  it("같은 번호가 지점마다 있으면 하나라도 미동의일 때 뺀다", async () => {
    const phone = uniquePhone();
    const a = await contact(f.branch1, true, phone);
    const b = await contact(f.branch2, false, phone);
    const result = await resolveRecipients(
      await asUser("hq"),
      [],
      [a.id, b.id],
      { isAd: true },
    );
    expect(result.recipients).toEqual([]);
    expect(result.noConsent).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  // 샘플은 무작위(20261106000500): 지점마다 500명, 동의 약 92%, 미동의 약 5%, 수신거부 약 3%.
  // 무작위라 범위로 본다. 1,500명이면 표준편차가 1%p 안쪽이라 넉넉한 범위에서 흔들리지 않는다.
  it("체험 샘플은 대부분 동의이고 일부는 미동의·수신거부다", async () => {
    const { data: user } = await service.auth.admin.createUser({
      email: `consent-${randomUUID()}@example.com`,
      email_confirm: true,
    });
    const org = must(
      await service.rpc("create_trial_org", { p_user_id: user.user?.id ?? "" }),
    );
    const total = await service
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org);
    const consented = await service
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org)
      .not("consent_at", "is", null);
    const optOuts = await service
      .from("opt_outs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org);
    expect(total.count).toBe(1500);
    const consentRate = (consented.count ?? 0) / 1500;
    expect(consentRate).toBeGreaterThan(0.87);
    expect(consentRate).toBeLessThan(0.97);
    expect(optOuts.count).toBeGreaterThan(15);
    expect(optOuts.count).toBeLessThan(80);

    await service
      .from("organizations")
      .update({ trial_expires_at: "2000-01-01T00:00:00Z" })
      .eq("id", org);
    await service.rpc("delete_expired_trials");
  });
});

describe("오늘 숫자 합계", () => {
  const FROM = "2000-01-01T00:00:00Z";

  async function campaign(branchId: string, delivered: number, failed: number) {
    const id = randomUUID();
    must(
      await service
        .from("campaigns")
        .insert({
          id,
          org_id: f.orgA,
          branch_id: branchId,
          body: "본문",
          sender_phone: "0212345678",
          status: "sending",
          recipient_count: 10,
          unit_price: 10,
          estimated_cost: 100,
          sent_count: 8,
          delivered_count: delivered,
          failed_count: failed,
          started_at: new Date().toISOString(),
        })
        .select("id"),
    );
    return id;
  }

  const totals = async (key: Parameters<Fixture["tokenOf"]>[0]) =>
    must(
      await (await asUser(key)).rpc("today_campaign_summary", { p_from: FROM }),
    )[0];

  it("RLS로 범위가 갈리고 확인 중은 대기를 빼고 센다", async () => {
    const hqBefore = await totals("hq");
    const branchBefore = await totals("branch1");
    await campaign(f.branch1, 5, 1);
    await campaign(f.branch2, 2, 0);

    const branch = await totals("branch1");
    expect(
      (branch?.campaign_count ?? 0) - (branchBefore?.campaign_count ?? 0),
    ).toBe(1);
    expect((branch?.delivered ?? 0) - (branchBefore?.delivered ?? 0)).toBe(5);
    expect((branch?.pending ?? 0) - (branchBefore?.pending ?? 0)).toBe(2);
    expect((branch?.failed ?? 0) - (branchBefore?.failed ?? 0)).toBe(1);

    const hq = await totals("hq");
    expect((hq?.campaign_count ?? 0) - (hqBefore?.campaign_count ?? 0)).toBe(2);
    expect((hq?.recipient_count ?? 0) - (hqBefore?.recipient_count ?? 0)).toBe(
      20,
    );
  });

  it("집계가 어긋나도 확인 중이 음수가 되지 않는다", async () => {
    const before = await totals("branch2");
    const id = await campaign(f.branch2, 8, 0);
    must(
      await service
        .from("campaigns")
        .update({ sent_count: 3 })
        .eq("id", id)
        .select("id"),
    );
    const after = await totals("branch2");
    expect(after?.pending).toBe(before?.pending);
  });

  it("다른 본사의 숫자가 섞이지 않는다", async () => {
    const before = await totals("hq");
    await service.rpc("seed_public_sample");
    const after = await totals("hq");
    expect(after?.recipient_count).toBe(before?.recipient_count);
    await service
      .from("organizations")
      .delete()
      .eq("id", "5a3b1e00-0000-4000-8000-000000000001");
  }, 120_000);

  it("로그인하지 않으면 부를 수 없다", async () => {
    const anon = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await anon.rpc("today_campaign_summary", {
      p_from: FROM,
    });
    expect(error?.code).toBe("42501");
  });
});

// 직접 입력한 번호는 주소록 밖일 수 있다. 같은 규칙(수신거부·동의·중복)을 resolveRecipients 하나에서 거친다.
describe("직접 입력한 번호", () => {
  const resolve = async (
    user: Parameters<Fixture["tokenOf"]>[0],
    phones: string[],
    isAd: boolean,
    contactIds: string[] = [],
  ) => resolveRecipients(await asUser(user), [], contactIds, { isAd }, phones);

  it("주소록에 없는 번호는 일반 문자에는 들어가고 광고에서는 미동의로 빠진다", async () => {
    const phone = uniquePhone();
    const plain = await resolve("branch1", [phone], false);
    const ad = await resolve("branch1", [phone], true);

    expect(plain.recipients).toEqual([{ phone, name: null }]);
    expect(ad.recipients).toEqual([]);
    expect(ad.noConsent).toBe(1);
  });

  it("동의한 연락처의 번호면 광고에도 들어가고 이름을 쓴다", async () => {
    const row = await contact(f.branch1, true);
    must(
      await service
        .from("contacts")
        .update({ name: "직접입력손님" })
        .eq("id", row.id)
        .select("id"),
    );
    const result = await resolve("branch1", [row.phone], true);
    expect(result.recipients).toEqual([
      { phone: row.phone, name: "직접입력손님" },
    ]);
  });

  it("다른 지점 연락처의 동의는 보이지 않아 쓰지 못한다", async () => {
    const other = await contact(f.branch2, true);
    const result = await resolve("branch1", [other.phone], true);
    expect(result.recipients).toEqual([]);
    expect(result.noConsent).toBe(1);
  });

  it("수신거부 번호는 주소록에 없어도 빠진다", async () => {
    const phone = uniquePhone();
    must(
      await service
        .from("opt_outs")
        .insert({ org_id: f.orgA, phone, source: "manual" })
        .select("id"),
    );
    const result = await resolve("branch1", [phone], false);
    expect(result).toMatchObject({ optedOut: 1, recipients: [] });
  });

  it("주소록에서 고른 사람과 같은 번호를 직접 넣어도 한 번만 보낸다", async () => {
    const row = await contact(f.branch1, true);
    const result = await resolve("branch1", [row.phone], false, [row.id]);
    expect(result.recipients).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });
});
