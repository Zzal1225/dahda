import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contactFiltersSchema,
  listContacts,
  listGroups,
  listOptOuts,
  optOutFiltersSchema,
} from "@/features/contacts/contact-query";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

let f: Fixture;
let groupId: string;

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
const filters = (input: object = {}) => contactFiltersSchema.parse(input);

beforeAll(async () => {
  f = await createFixture();

  const rows = must(
    await service
      .from("contacts")
      .insert([
        {
          org_id: f.orgA,
          branch_id: f.branch1,
          phone: "01000001111",
          name: "김철수",
        },
        {
          org_id: f.orgA,
          branch_id: f.branch1,
          phone: "01000002222",
          name: "이영희",
        },
        {
          org_id: f.orgA,
          branch_id: f.branch1,
          phone: "01000003333",
          name: "100%할인",
        },
      ])
      .select("id, phone"),
  );
  groupId = must(
    await service
      .from("contact_groups")
      .insert({ org_id: f.orgA, branch_id: f.branch1, name: "VIP" })
      .select("id")
      .single(),
  ).id;
  const kim = rows.find((row) => row.phone === "01000001111");
  must(
    await service
      .from("contact_group_members")
      .insert({
        group_id: groupId,
        contact_id: kim?.id ?? "",
        org_id: f.orgA,
        branch_id: f.branch1,
      })
      .select("group_id"),
  );
  must(
    await service
      .from("opt_outs")
      .insert({ org_id: f.orgA, phone: "01000002222", source: "manual" })
      .select("id"),
  );
});

afterAll(async () => {
  await f.cleanup();
});

describe("listContacts", () => {
  it("지점은 자기 지점만, 본사는 전 지점을 지점 이름과 함께 본다", async () => {
    const asBranch = await listContacts(await asUser("branch2"), filters());
    expect(asBranch.rows.every((r) => r.branchId === f.branch2)).toBe(true);
    expect(asBranch.total).toBe(asBranch.rows.length);

    const asHq = await listContacts(await asUser("hq"), filters());
    expect(new Set(asHq.rows.map((r) => r.branchName))).toEqual(
      new Set(["성수점", "망원점"]),
    );
  });

  it("타사 본사에는 보이지 않는다", async () => {
    const { rows } = await listContacts(await asUser("otherHq"), filters());
    expect(rows.some((r) => r.phone === "01000001111")).toBe(false);
  });

  it("지점 사용자가 다른 지점으로 필터해도 빈 결과다", async () => {
    const { rows, total } = await listContacts(
      await asUser("branch2"),
      filters({ branch: f.branch1 }),
    );
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("그룹으로 거르면 그 그룹만, 안 거르면 그룹 없는 연락처도 나온다", async () => {
    const client = await asUser("branch1");
    const inGroup = await listContacts(client, filters({ group: groupId }));
    expect(inGroup.rows.map((r) => r.phone)).toEqual(["01000001111"]);
    expect(inGroup.total).toBe(1);
    expect(inGroup.rows[0]?.groupIds).toEqual([groupId]);

    const all = await listContacts(client, filters());
    expect(all.rows.some((r) => r.groupIds.length === 0)).toBe(true);
  });

  it("번호는 앞부분, 이름은 부분 일치로 찾고 하이픈을 무시한다", async () => {
    const client = await asUser("branch1");
    const byPhone = await listContacts(client, filters({ q: "010-0000-1" }));
    expect(byPhone.rows.map((r) => r.name)).toEqual(["김철수"]);

    const byName = await listContacts(client, filters({ q: "영희" }));
    expect(byName.rows.map((r) => r.phone)).toEqual(["01000002222"]);
  });

  it("검색어의 %와 _는 와일드카드가 아니라 글자다", async () => {
    const client = await asUser("branch1");
    const percent = await listContacts(client, filters({ q: "100%" }));
    expect(percent.rows.map((r) => r.name)).toEqual(["100%할인"]);

    const onlyPercent = await listContacts(client, filters({ q: "%철" }));
    expect(onlyPercent.rows).toEqual([]);
  });

  it("수신거부 번호를 표시한다", async () => {
    const { rows } = await listContacts(await asUser("branch1"), filters());
    expect(rows.find((r) => r.phone === "01000002222")?.optedOut).toBe(true);
    expect(rows.find((r) => r.phone === "01000001111")?.optedOut).toBe(false);
  });
});

describe("contactFiltersSchema", () => {
  it("잘못된 URL 값은 조건 없음으로 처리한다", () => {
    expect(
      filters({ group: "abc", branch: "x", status: "zz", page: "-1", q: "  " }),
    ).toEqual({ q: "", group: null, branch: null, status: null, page: 1 });
  });

  it("수신거부 보기는 그룹 자리의 opt-outs 값이다", () => {
    expect(filters({ group: "opt-outs", status: "opted_out" })).toMatchObject({
      group: "opt-outs",
      status: "opted_out",
    });
  });
});

describe("listContacts: 수신 상태·뒤 4자리", () => {
  it("수신 상태로 거른다. 수신거부가 동의보다 앞선다", async () => {
    // 이영희는 수신거부다. 동의 기록이 있어도 수신거부로 본다.
    await service
      .from("contacts")
      .update({ consent_at: "2026-01-01T00:00:00Z" })
      .in("phone", ["01000002222", "01000003333"]);
    const client = await asUser("branch1");

    const status = async (value: string) =>
      (await listContacts(client, filters({ status: value }))).rows.map(
        (row) => row.phone,
      );
    expect(await status("opted_out")).toEqual(["01000002222"]);
    expect(await status("consented")).toContain("01000003333");
    expect(await status("consented")).not.toContain("01000002222");
    expect(await status("not_consented")).toContain("01000001111");

    const { rows } = await listContacts(client, filters());
    expect(rows.find((r) => r.phone === "01000002222")?.receiveStatus).toBe(
      "opted_out",
    );
  });

  it("숫자 4자리 이하는 번호 끝, 더 길면 번호 앞으로 찾는다", async () => {
    const client = await asUser("branch1");
    const suffix = await listContacts(client, filters({ q: "1111" }));
    expect(suffix.rows.map((r) => r.phone)).toEqual(["01000001111"]);
    // 0100 앞자리는 모든 번호에 있지만 4자리라 끝으로 찾는다.
    const notPrefix = await listContacts(client, filters({ q: "0100" }));
    expect(notPrefix.rows).toEqual([]);
    const prefix = await listContacts(client, filters({ q: "010-0000-2" }));
    expect(prefix.rows.map((r) => r.phone)).toEqual(["01000002222"]);
  });

  it("수신거부 보기 값은 그룹 조건이 아니다", async () => {
    const client = await asUser("branch1");
    const all = await listContacts(client, filters());
    const view = await listContacts(client, filters({ group: "opt-outs" }));
    expect(view.total).toBe(all.total);
  });

  it("등록일과 지점 이름을 함께 준다", async () => {
    const { rows } = await listContacts(await asUser("hq"), filters());
    expect(rows.every((row) => row.createdAt && row.branchName)).toBe(true);
  });
});

describe("listGroups", () => {
  it("그룹 인원을 함께 준다", async () => {
    const rows = await listGroups(await asUser("branch1"));
    const vip = rows.find((row) => row.id === groupId);
    expect(vip?.memberCount).toBe(1);
  });

  it("다른 지점 그룹은 보이지 않는다", async () => {
    const rows = await listGroups(await asUser("branch2"));
    expect(rows.some((row) => row.id === groupId)).toBe(false);
  });
});

describe("listOptOuts", () => {
  it("지점도 본사 공통 목록을 보고, 타사 목록은 보지 못한다", async () => {
    const parse = (input: object = {}) => optOutFiltersSchema.parse(input);
    const asBranch = await listOptOuts(await asUser("branch2"), parse());
    expect(asBranch.rows.map((r) => r.phone)).toContain("01000002222");

    const other = await listOptOuts(await asUser("otherHq"), parse());
    expect(other.rows.map((r) => r.phone)).not.toContain("01000002222");
  });

  it("번호 앞부분으로 찾는다", async () => {
    const { rows } = await listOptOuts(
      await asUser("hq"),
      optOutFiltersSchema.parse({ q: "010-0000-22" }),
    );
    expect(rows.map((r) => r.phone)).toEqual(["01000002222"]);
  });
});
