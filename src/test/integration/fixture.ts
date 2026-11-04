import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";

/**
 * 권한 검사는 DB에 SET ROLE로 접속하지 않고 실제 로그인 토큰으로 REST API를 부른다.
 * 브라우저가 지나는 경로(토큰 검증 → 역할 전환 → GRANT → RLS)를 그대로 지나야 "막힌다"는 말이 성립한다.
 */
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const PUBLISHABLE_KEY = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const PASSWORD = "local-integration-test";

export const service: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SECRET_KEY,
  clientOptions,
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name}이 없다. vitest.integration.config.mts로 실행한다.`,
    );
  return value;
}

/** 준비 단계의 실패를 "권한이 막혀서 0건"으로 착각하지 않도록 바로 터뜨린다. */
export function must<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined) {
    throw new Error("데이터가 비어 있다");
  }
  return result.data;
}

export type RestResult = {
  status: number;
  rows: Record<string, unknown>[];
  code?: string;
};

/** token이 없으면 비로그인(anon) 요청이다. */
export async function rest(
  token: string | null,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<RestResult> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      // 쓰기 결과를 받아야 "0건 처리"와 "실제 변경"을 구분할 수 있다.
      Prefer: "return=representation",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (Array.isArray(parsed)) {
    return {
      status: response.status,
      rows: parsed as Record<string, unknown>[],
    };
  }
  const code = (parsed as { code?: unknown } | null)?.code;
  return {
    status: response.status,
    rows: [],
    ...(typeof code === "string" ? { code } : {}),
  };
}

/** API가 노출하는 테이블·뷰 전체. 손으로 적은 목록이면 새 테이블이 검사에서 빠져도 알 수 없다. */
export async function listExposedTables(): Promise<string[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SECRET_KEY, Accept: "application/openapi+json" },
  });
  const spec = (await response.json()) as { paths: Record<string, unknown> };
  return Object.keys(spec.paths)
    .filter((path) => path !== "/" && !path.startsWith("/rpc/"))
    .map((path) => path.slice(1));
}

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `it-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(error?.message ?? "사용자 생성 실패");
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<string> {
  const client = createClient<Database>(
    SUPABASE_URL,
    PUBLISHABLE_KEY,
    clientOptions,
  );
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(error?.message ?? "로그인 실패");
  return data.session.access_token;
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * 파일마다 자기 본사를 만든다. 공용 시드에 기대면 한 테스트의 쓰기가 다른 테스트의 건수를 바꾼다.
 *
 * 구성: A본사(지점 1·2 + 본사 계정), B본사(지점 + 본사 계정).
 * 모든 테이블의 모든 계정에 행을 넣는다. 행이 없으면 "안 보인다"가 권한 때문인지 데이터가 없어서인지 알 수 없다.
 */
export async function createFixture() {
  const [orgA, orgB] = must(
    await service
      .from("organizations")
      .insert([{ name: "통합테스트 A본사" }, { name: "통합테스트 B본사" }])
      .select("id"),
  ).map((row) => row.id);
  if (!orgA || !orgB) throw new Error("본사 생성 실패");

  const [branch1, branch2, branchB] = must(
    await service
      .from("branches")
      .insert([
        { org_id: orgA, name: "성수점" },
        { org_id: orgA, name: "망원점" },
        { org_id: orgB, name: "타사점" },
      ])
      .select("id"),
  ).map((row) => row.id);
  if (!branch1 || !branch2 || !branchB) throw new Error("지점 생성 실패");

  const users = {
    hq: await createUser(),
    branch1: await createUser(),
    branch2: await createUser(),
    otherHq: await createUser(),
    outsider: await createUser(), // 로그인은 했지만 members 행이 없는 사용자
  };

  must(
    await service
      .from("members")
      .insert([
        {
          user_id: users.hq.id,
          org_id: orgA,
          branch_id: null,
          role: "hq",
          display_name: "A본사",
        },
        {
          user_id: users.branch1.id,
          org_id: orgA,
          branch_id: branch1,
          role: "branch",
          display_name: "성수 담당",
        },
        {
          user_id: users.branch2.id,
          org_id: orgA,
          branch_id: branch2,
          role: "branch",
          display_name: "망원 담당",
        },
        {
          user_id: users.otherHq.id,
          org_id: orgB,
          branch_id: null,
          role: "hq",
          display_name: "B본사",
        },
      ])
      .select("user_id"),
  );

  const accounts = [
    { org_id: orgA, branch_id: branch1 },
    { org_id: orgA, branch_id: branch2 },
    { org_id: orgA, branch_id: null },
    { org_id: orgB, branch_id: branchB },
    { org_id: orgB, branch_id: null },
  ];
  const branchAccounts = accounts.flatMap((account) =>
    account.branch_id
      ? [{ org_id: account.org_id, branch_id: account.branch_id }]
      : [],
  );

  must(
    await service
      .from("sender_numbers")
      .insert(
        accounts.map((a) => ({ ...a, number: "0212345678", label: "대표" })),
      )
      .select("id"),
  );

  const campaigns = must(
    await service
      .from("campaigns")
      .insert(
        accounts.map((a) => ({
          ...a,
          status: "scheduled" as const,
          sender_phone: "0212345678",
          body: "테스트",
          recipient_count: 1,
          unit_price: 20,
          estimated_cost: 20,
        })),
      )
      .select("id, org_id, branch_id"),
  );

  must(
    await service
      .from("messages")
      .insert(
        campaigns.map((c) => ({
          campaign_id: c.id,
          org_id: c.org_id,
          phone: "01000000001",
        })),
      )
      .select("id"),
  );

  const payments = must(
    await service
      .from("payments")
      .insert(
        accounts.map((a) => {
          const orderId = randomUUID();
          return {
            ...a,
            order_id: orderId,
            payment_key: orderId,
            amount: 1000,
            status: "done" as const,
          };
        }),
      )
      .select("id, org_id, branch_id, order_id"),
  );

  must(
    await service
      .from("ledger_entries")
      .insert(
        payments.map((p) => ({
          org_id: p.org_id,
          branch_id: p.branch_id,
          kind: "charge" as const,
          amount: 1000,
          payment_id: p.id,
          idempotency_key: `charge:${p.order_id}`,
        })),
      )
      .select("id"),
  );

  const contacts = must(
    await service
      .from("contacts")
      .insert(branchAccounts.map((a) => ({ ...a, phone: "01000000001" })))
      .select("id, org_id, branch_id"),
  );
  const groups = must(
    await service
      .from("contact_groups")
      .insert(branchAccounts.map((a) => ({ ...a, name: "단골" })))
      .select("id, org_id, branch_id"),
  );
  must(
    await service
      .from("contact_group_members")
      .insert(
        groups.map((group) => {
          const contact = contacts.find((c) => c.branch_id === group.branch_id);
          if (!contact) throw new Error("연락처를 찾지 못했다");
          return {
            group_id: group.id,
            contact_id: contact.id,
            org_id: group.org_id,
            branch_id: group.branch_id,
          };
        }),
      )
      .select("group_id"),
  );

  must(
    await service
      .from("opt_outs")
      .insert([
        { org_id: orgA, phone: "01099990001", source: "manual" },
        { org_id: orgB, phone: "01099990002", source: "manual" },
      ])
      .select("id"),
  );

  const webhookEvents = must(
    await service
      .from("webhook_events")
      .insert({ provider: "fake", raw_body: "{}", signature_valid: true })
      .select("id"),
  );

  const tokens = new Map<keyof typeof users, string>();

  return {
    orgA,
    orgB,
    branch1,
    branch2,
    branchB,
    users,
    campaigns,
    contacts,
    groups,
    /** 필요한 사용자만 로그인한다. 로컬 Auth의 로그인 횟수 제한을 아끼려는 것이다. */
    async tokenOf(user: keyof typeof users): Promise<string> {
      const cached = tokens.get(user);
      if (cached) return cached;
      const token = await signIn(users[user].email);
      tokens.set(user, token);
      return token;
    },
    async cleanup() {
      await service.from("organizations").delete().in("id", [orgA, orgB]);
      await service
        .from("webhook_events")
        .delete()
        .in(
          "id",
          webhookEvents.map((event) => event.id),
        );
      await Promise.all(
        Object.values(users).map((u) => service.auth.admin.deleteUser(u.id)),
      );
    },
  };
}
