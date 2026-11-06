import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { must, service } from "./fixture";

// 체험 주소록 샘플(20261106000500)과 발송 샘플 수신자 잇기. 무작위 값이라 개수·범위·규칙만 본다.

let userId = "";
let orgId = "";

beforeAll(async () => {
  const created = await service.auth.admin.createUser({
    email: `trial-contacts-${randomUUID()}@example.com`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "사용자 생성 실패");
  }
  userId = created.data.user.id;
  orgId = must(await service.rpc("create_trial_org", { p_user_id: userId }));
});

afterAll(async () => {
  await service.from("organizations").delete().eq("id", orgId);
  await service.auth.admin.deleteUser(userId);
});

describe("체험 주소록 샘플", () => {
  it("지점마다 500명, 서로 다른 사람이고 번호는 안전 대역이다", async () => {
    // REST 한 번 응답은 1,000행이 상한이라 두 번에 나눠 읽는다.
    const page = async (from: number) =>
      must(
        await service
          .from("contacts")
          .select("id, branch_id, phone, name, memo, created_at")
          .eq("org_id", orgId)
          .order("id")
          .range(from, from + 999),
      );
    const contacts = [...(await page(0)), ...(await page(1000))];
    expect(contacts).toHaveLength(1500);

    const perBranch = new Map<string, number>();
    for (const row of contacts) {
      perBranch.set(row.branch_id, (perBranch.get(row.branch_id) ?? 0) + 1);
    }
    expect([...perBranch.values()]).toEqual([500, 500, 500]);
    expect(new Set(contacts.map((row) => row.phone)).size).toBe(1500);
    expect(contacts.every((row) => /^0100[1-9][0-9]{6}$/.test(row.phone))).toBe(
      true,
    );
    expect(contacts.every((row) => row.name && row.name.length >= 2)).toBe(
      true,
    );

    const memo = contacts.filter((row) => row.memo).length / 1500;
    expect(memo).toBeGreaterThan(0.05);
    expect(memo).toBeLessThan(0.15);

    const sixMonths = Date.now() - 181 * 86_400_000;
    expect(
      contacts.every((row) => Date.parse(row.created_at) >= sixMonths),
    ).toBe(true);
  });

  it("그룹은 지점마다 4~5개이고 한 사람은 0~2개 그룹에 있다", async () => {
    const groups = must(
      await service
        .from("contact_groups")
        .select("branch_id, name")
        .eq("org_id", orgId),
    );
    const perBranch = new Map<string, string[]>();
    for (const group of groups) {
      perBranch.set(group.branch_id, [
        ...(perBranch.get(group.branch_id) ?? []),
        group.name,
      ]);
    }
    for (const names of perBranch.values()) {
      expect(names.length).toBeGreaterThanOrEqual(4);
      expect(names.length).toBeLessThanOrEqual(5);
      expect(names).toEqual(expect.arrayContaining(["단골", "신규"]));
    }

    const members = must(
      await service
        .from("contact_group_members")
        .select("contact_id")
        .eq("org_id", orgId)
        .range(0, 4999),
    );
    const perContact = new Map<string, number>();
    for (const row of members) {
      perContact.set(row.contact_id, (perContact.get(row.contact_id) ?? 0) + 1);
    }
    expect(Math.max(...perContact.values())).toBeLessThanOrEqual(2);
    // 그룹이 없는 사람도 있다.
    expect(perContact.size).toBeLessThan(1500);
  });

  it("발송 샘플 수신자는 주소록 사람이고, 수신거부는 받지 않았고, 광고는 동의한 사람만 받았다", async () => {
    const { count: unlinked } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .like("phone", "01000%");
    expect(unlinked).toBe(0);

    const optOuts = must(
      await service.from("opt_outs").select("phone").eq("org_id", orgId),
    );
    const { count: toOptOut } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in(
        "phone",
        optOuts.map((row) => row.phone),
      );
    expect(toOptOut).toBe(0);

    // 지점 광고 샘플(성수점 주말 과일 할인 30명)의 수신자는 모두 그 지점의 동의한 사람이다.
    const campaign = must(
      await service
        .from("campaigns")
        .select("id, branch_id")
        .eq("org_id", orgId)
        .eq("is_ad", true)
        .eq("recipient_count", 30)
        .single(),
    );
    const phones = must(
      await service
        .from("messages")
        .select("phone, recipient_name")
        .eq("campaign_id", campaign.id),
    );
    const contacts = must(
      await service
        .from("contacts")
        .select("phone, name, consent_at")
        .eq("branch_id", campaign.branch_id ?? "")
        .in(
          "phone",
          phones.map((row) => row.phone),
        ),
    );
    expect(contacts).toHaveLength(30);
    expect(contacts.every((row) => row.consent_at !== null)).toBe(true);
    // 받는 사람 이름도 주소록 이름이다(발송 내역과 주소록이 같은 사람을 가리킨다).
    const nameOf = new Map(contacts.map((row) => [row.phone, row.name]));
    expect(
      phones.every((row) => nameOf.get(row.phone) === row.recipient_name),
    ).toBe(true);
  });
});
