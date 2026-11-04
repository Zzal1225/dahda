import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixture,
  listExposedTables,
  must,
  rest,
  service,
  type Fixture,
} from "./fixture";

/** 권한 위반(GRANT 또는 RLS)의 Postgres 코드. 상태 코드가 아니라 이 코드로 봐야 다른 오류와 섞이지 않는다. */
const DENIED = "42501";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await f.cleanup();
});

/** null은 "본사 계정"이라는 유효한 값이라 정렬 키로 남긴다. */
function branchSet(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => String(row.branch_id)).sort();
}

describe("API에 노출된 모든 테이블", () => {
  // 목록을 API에서 읽으므로 새 테이블을 추가하고 정책을 잊어도 여기서 걸린다.
  it("검사 대상이 있고 모두 행이 들어 있다", async () => {
    const tables = await listExposedTables();
    expect(tables.length).toBeGreaterThanOrEqual(14);

    for (const table of tables) {
      const { count, error } = await service
        .from(table as "organizations")
        .select("*", { count: "exact", head: true });
      expect(error, table).toBeNull();
      // 행이 없으면 아래 "0건" 검사가 권한과 무관하게 통과한다.
      expect(count, table).toBeGreaterThan(0);
    }
  });

  it("비로그인 사용자는 어떤 테이블도 읽지 못한다", async () => {
    for (const table of await listExposedTables()) {
      const result = await rest(null, "GET", `${table}?select=*&limit=1`);
      expect(result.code, table).toBe(DENIED);
    }
  });

  it("소속이 없는 로그인 사용자에게는 아무 행도 보이지 않는다", async () => {
    const token = await f.tokenOf("outsider");
    for (const table of await listExposedTables()) {
      const result = await rest(token, "GET", `${table}?select=*&limit=1`);
      expect(result.rows, table).toEqual([]);
    }
  });
});

describe("조회 범위", () => {
  const accountOwned = [
    "sender_numbers",
    "campaigns",
    "messages",
    "payments",
    "ledger_entries",
    "account_balances",
  ];
  const branchOwned = ["contacts", "contact_groups", "contact_group_members"];

  it.each([...accountOwned, ...branchOwned])(
    "%s: 지점은 자기 지점 행만 본다",
    async (table) => {
      const token = await f.tokenOf("branch1");
      const { rows } = await rest(token, "GET", `${table}?select=branch_id`);
      expect(branchSet(rows)).toEqual([f.branch1]);
    },
  );

  it.each(accountOwned)(
    "%s: 본사는 전 지점과 본사 계정을 보고 타사는 못 본다",
    async (table) => {
      const token = await f.tokenOf("hq");
      const { rows } = await rest(token, "GET", `${table}?select=branch_id`);
      expect(branchSet(rows)).toEqual([f.branch1, f.branch2, "null"].sort());
    },
  );

  it.each(branchOwned)(
    "%s: 본사는 전 지점을 보고 타사는 못 본다",
    async (table) => {
      const token = await f.tokenOf("hq");
      const { rows } = await rest(token, "GET", `${table}?select=branch_id`);
      expect(branchSet(rows)).toEqual([f.branch1, f.branch2].sort());
    },
  );

  it("타사 본사는 자기 행만 본다", async () => {
    const token = await f.tokenOf("otherHq");
    const { rows } = await rest(token, "GET", "campaigns?select=org_id");
    expect(rows.map((row) => row.org_id)).toEqual([f.orgB, f.orgB]);
  });

  it("branches: 지점은 자기 지점, 본사는 자기 본사의 지점만 본다", async () => {
    const asBranch = await rest(
      await f.tokenOf("branch1"),
      "GET",
      "branches?select=id",
    );
    expect(asBranch.rows.map((row) => row.id)).toEqual([f.branch1]);

    const asHq = await rest(await f.tokenOf("hq"), "GET", "branches?select=id");
    expect(asHq.rows.map((row) => String(row.id)).sort()).toEqual(
      [f.branch1, f.branch2].sort(),
    );
  });

  it("members: 지점은 자기 행만, 본사는 자기 본사 전체를 본다", async () => {
    const asBranch = await rest(
      await f.tokenOf("branch1"),
      "GET",
      "members?select=user_id",
    );
    expect(asBranch.rows.map((row) => row.user_id)).toEqual([
      f.users.branch1.id,
    ]);

    const asHq = await rest(
      await f.tokenOf("hq"),
      "GET",
      "members?select=user_id",
    );
    expect(asHq.rows.map((row) => String(row.user_id)).sort()).toEqual(
      [f.users.hq.id, f.users.branch1.id, f.users.branch2.id].sort(),
    );
  });

  it("organizations: 자기 본사만 본다", async () => {
    const { rows } = await rest(
      await f.tokenOf("branch1"),
      "GET",
      "organizations?select=id",
    );
    expect(rows.map((row) => row.id)).toEqual([f.orgA]);
  });

  it("opt_outs: 지점도 본사 공통 목록을 보지만 타사 목록은 못 본다", async () => {
    const { rows } = await rest(
      await f.tokenOf("branch1"),
      "GET",
      "opt_outs?select=org_id",
    );
    expect(rows.map((row) => row.org_id)).toEqual([f.orgA]);
  });

  it("webhook_events: 사용자는 본사여도 읽지 못한다", async () => {
    const result = await rest(
      await f.tokenOf("hq"),
      "GET",
      "webhook_events?select=id",
    );
    expect(result.code).toBe(DENIED);
  });
});

describe("서버 전용 테이블", () => {
  // RLS로 행을 거르는 것이 아니라 권한 자체가 없어야 한다. 상태 전이와 금액을 사용자가 고칠 길을 막는다.
  const serverOnly = [
    { table: "organizations", filter: "id=not.is.null", column: "name" },
    { table: "members", filter: "user_id=not.is.null", column: "display_name" },
    { table: "sender_numbers", filter: "id=not.is.null", column: "label" },
    { table: "campaigns", filter: "id=not.is.null", column: "body" },
    { table: "messages", filter: "id=not.is.null", column: "fail_code" },
    { table: "payments", filter: "id=not.is.null", column: "order_id" },
    {
      table: "ledger_entries",
      filter: "id=not.is.null",
      column: "idempotency_key",
    },
    { table: "webhook_events", filter: "id=not.is.null", column: "error" },
  ];

  describe.each(["hq", "branch1"] as const)("%s", (user) => {
    it.each(serverOnly)(
      "$table: 추가·수정·삭제 모두 거부",
      async ({ table, filter, column }) => {
        const token = await f.tokenOf(user);
        const inserted = await rest(token, "POST", table, { [column]: "x" });
        const updated = await rest(token, "PATCH", `${table}?${filter}`, {
          [column]: "x",
        });
        const deleted = await rest(token, "DELETE", `${table}?${filter}`);
        expect([inserted.code, updated.code, deleted.code]).toEqual([
          DENIED,
          DENIED,
          DENIED,
        ]);
      },
    );
  });

  it("지점은 자기 발송 건의 상태를 바꿔 승인을 건너뛸 수 없다", async () => {
    const own = f.campaigns.find((c) => c.branch_id === f.branch1);
    const result = await rest(
      await f.tokenOf("branch1"),
      "PATCH",
      `campaigns?id=eq.${own?.id}`,
      {
        status: "sending",
      },
    );
    expect(result.code).toBe(DENIED);

    const after = must(
      await service
        .from("campaigns")
        .select("status")
        .eq("id", own?.id ?? ""),
    );
    expect(after[0]?.status).toBe("scheduled");
  });

  it("지점은 자기 역할을 본사로 올릴 수 없다", async () => {
    const result = await rest(
      await f.tokenOf("branch1"),
      "PATCH",
      `members?user_id=eq.${f.users.branch1.id}`,
      { role: "hq", branch_id: null },
    );
    expect(result.code).toBe(DENIED);
  });

  it.each(["hq", "branch1"] as const)(
    "%s는 잔액 함수를 직접 부를 수 없다",
    async (user) => {
      const campaign = f.campaigns.find((c) => c.branch_id === f.branch2);
      const result = await rest(
        await f.tokenOf(user),
        "POST",
        "rpc/reserve_balance",
        {
          p_org_id: f.orgA,
          p_branch_id: f.branch2,
          p_campaign_id: campaign?.id,
          p_amount: 10,
          p_idempotency_key: `denied-${user}`,
        },
      );
      expect(result.code).toBe(DENIED);
    },
  );
});

describe("주소록 쓰기", () => {
  const newContact = (org: string, branch: string, phone: string) => ({
    org_id: org,
    branch_id: branch,
    phone,
  });

  it("지점은 자기 지점에 추가할 수 있다", async () => {
    const result = await rest(
      await f.tokenOf("branch1"),
      "POST",
      "contacts",
      newContact(f.orgA, f.branch1, "01000001001"),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("지점은 옆 지점에 추가할 수 없다", async () => {
    const result = await rest(
      await f.tokenOf("branch1"),
      "POST",
      "contacts",
      newContact(f.orgA, f.branch2, "01000001002"),
    );
    expect(result.code).toBe(DENIED);
  });

  it("옆 지점 연락처 수정·삭제는 0건 처리되고 원본이 남는다", async () => {
    const other = f.contacts.find((c) => c.branch_id === f.branch2);
    const token = await f.tokenOf("branch1");

    const updated = await rest(token, "PATCH", `contacts?id=eq.${other?.id}`, {
      memo: "침범",
    });
    const deleted = await rest(token, "DELETE", `contacts?id=eq.${other?.id}`);
    expect(updated.rows).toEqual([]);
    expect(deleted.rows).toEqual([]);

    const after = must(
      await service
        .from("contacts")
        .select("memo")
        .eq("id", other?.id ?? ""),
    );
    expect(after).toEqual([{ memo: null }]);
  });

  it("자기 연락처를 옆 지점으로 옮길 수 없다", async () => {
    const own = f.contacts.find((c) => c.branch_id === f.branch1);
    const result = await rest(
      await f.tokenOf("branch1"),
      "PATCH",
      `contacts?id=eq.${own?.id}`,
      {
        branch_id: f.branch2,
      },
    );
    expect(result.code).toBe(DENIED);
  });

  it("본사는 주소록을 조회만 한다", async () => {
    const token = await f.tokenOf("hq");
    const own = f.contacts.find((c) => c.branch_id === f.branch1);

    const inserted = await rest(
      token,
      "POST",
      "contacts",
      newContact(f.orgA, f.branch1, "01000001003"),
    );
    const updated = await rest(token, "PATCH", `contacts?id=eq.${own?.id}`, {
      memo: "본사",
    });
    const deleted = await rest(token, "DELETE", `contacts?id=eq.${own?.id}`);

    expect(inserted.code).toBe(DENIED);
    expect(updated.rows).toEqual([]);
    expect(deleted.rows).toEqual([]);
  });

  it("옆 지점 연락처를 내 그룹에 넣을 수 없다", async () => {
    const token = await f.tokenOf("branch1");
    const myGroup = f.groups.find((g) => g.branch_id === f.branch1);
    const otherContact = f.contacts.find((c) => c.branch_id === f.branch2);

    // 소속을 내 지점이라고 적어도 복합 외래 키가, 옆 지점이라고 적으면 정책이 막는다.
    const claimingMine = await rest(token, "POST", "contact_group_members", {
      group_id: myGroup?.id,
      contact_id: otherContact?.id,
      org_id: f.orgA,
      branch_id: f.branch1,
    });
    const claimingOther = await rest(token, "POST", "contact_group_members", {
      group_id: myGroup?.id,
      contact_id: otherContact?.id,
      org_id: f.orgA,
      branch_id: f.branch2,
    });

    expect(claimingMine.code).toBe("23503");
    expect(claimingOther.code).toBe(DENIED);
  });
});

describe("수신거부", () => {
  const entry = (org: string, user: string, phone: string) => ({
    org_id: org,
    phone,
    source: "manual",
    created_by: user,
  });

  it("지점은 등록할 수 있지만 해제하지 못한다", async () => {
    const token = await f.tokenOf("branch1");
    const phone = "01099991001";

    const inserted = await rest(
      token,
      "POST",
      "opt_outs",
      entry(f.orgA, f.users.branch1.id, phone),
    );
    expect(inserted.rows).toHaveLength(1);

    const deleted = await rest(token, "DELETE", `opt_outs?phone=eq.${phone}`);
    expect(deleted.rows).toEqual([]);

    const still = must(
      await service.from("opt_outs").select("id").eq("phone", phone),
    );
    expect(still).toHaveLength(1);
  });

  it("본사는 해제할 수 있다", async () => {
    const phone = "01099991002";
    must(
      await service
        .from("opt_outs")
        .insert({ org_id: f.orgA, phone, source: "manual" })
        .select("id"),
    );

    const deleted = await rest(
      await f.tokenOf("hq"),
      "DELETE",
      `opt_outs?phone=eq.${phone}`,
    );
    expect(deleted.rows).toHaveLength(1);
  });

  it("타사 목록에 등록하거나 등록자를 속일 수 없다", async () => {
    const token = await f.tokenOf("branch1");
    const otherOrg = await rest(
      token,
      "POST",
      "opt_outs",
      entry(f.orgB, f.users.branch1.id, "01099991003"),
    );
    const spoofed = await rest(
      token,
      "POST",
      "opt_outs",
      entry(f.orgA, f.users.hq.id, "01099991004"),
    );

    expect(otherOrg.code).toBe(DENIED);
    expect(spoofed.code).toBe(DENIED);
  });

  it("수신거부는 수정할 수 없다", async () => {
    const result = await rest(
      await f.tokenOf("hq"),
      "PATCH",
      "opt_outs?phone=eq.01099990001",
      {
        reason: "변경",
      },
    );
    expect(result.code).toBe(DENIED);
  });
});

describe("지점 관리", () => {
  it("지점은 지점을 추가할 수 없다", async () => {
    const result = await rest(await f.tokenOf("branch1"), "POST", "branches", {
      org_id: f.orgA,
      name: "무단 지점",
    });
    expect(result.code).toBe(DENIED);
  });

  it("지점은 지점 이름을 바꿀 수 없다", async () => {
    const result = await rest(
      await f.tokenOf("branch1"),
      "PATCH",
      `branches?id=eq.${f.branch1}`,
      {
        name: "무단 변경",
      },
    );
    expect(result.rows).toEqual([]);
  });

  it("본사는 자기 본사에 지점을 추가하고 이름을 바꿀 수 있다", async () => {
    const token = await f.tokenOf("hq");
    const inserted = await rest(token, "POST", "branches", {
      org_id: f.orgA,
      name: "합정점",
    });
    expect(inserted.rows).toHaveLength(1);

    const updated = await rest(
      token,
      "PATCH",
      `branches?id=eq.${String(inserted.rows[0]?.id)}`,
      {
        name: "합정본점",
      },
    );
    expect(updated.rows[0]?.name).toBe("합정본점");
  });

  it("본사는 타사에 지점을 추가하거나 타사 지점을 바꿀 수 없다", async () => {
    const token = await f.tokenOf("hq");
    const inserted = await rest(token, "POST", "branches", {
      org_id: f.orgB,
      name: "침범",
    });
    const updated = await rest(token, "PATCH", `branches?id=eq.${f.branchB}`, {
      name: "침범",
    });

    expect(inserted.code).toBe(DENIED);
    expect(updated.rows).toEqual([]);
  });

  it("본사도 지점을 다른 본사로 옮기거나 삭제할 수 없다", async () => {
    const token = await f.tokenOf("hq");
    const moved = await rest(token, "PATCH", `branches?id=eq.${f.branch1}`, {
      org_id: f.orgB,
    });
    const deleted = await rest(token, "DELETE", `branches?id=eq.${f.branch1}`);

    expect(moved.code).toBe(DENIED);
    expect(deleted.code).toBe(DENIED);
  });
});

describe("역할 전환", () => {
  it("서버가 역할을 바꾸면 같은 토큰의 다음 요청부터 범위가 바뀐다", async () => {
    // 권한을 토큰이 아니라 members에서 읽기 때문에 가능하다. 체험 계정의 전환이 가짜가 아니라는 근거다.
    const token = await f.tokenOf("branch2");
    const before = await rest(token, "GET", "contacts?select=branch_id");
    expect(branchSet(before.rows)).toEqual([f.branch2]);

    must(
      await service
        .from("members")
        .update({ role: "hq", branch_id: null })
        .eq("user_id", f.users.branch2.id)
        .select("user_id"),
    );
    const asHq = await rest(token, "GET", "branches?select=id");
    expect(asHq.rows.length).toBeGreaterThan(1);

    must(
      await service
        .from("members")
        .update({ role: "branch", branch_id: f.branch2 })
        .eq("user_id", f.users.branch2.id)
        .select("user_id"),
    );
    const after = await rest(token, "GET", "contacts?select=branch_id");
    expect(branchSet(after.rows)).toEqual([f.branch2]);
  });
});
