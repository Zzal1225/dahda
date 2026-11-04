/**
 * 10만 행 측정용 본사를 만든다. 실행: npm run db:seed:large
 *
 * supabase/seed.sql에 넣지 않은 이유: db reset마다 돌아 테스트 환경 준비가 느려지고, 측정 데이터가 필요 없는
 * 작업까지 비용을 치른다. SQL 대신 스크립트인 이유: 로그인 계정은 Auth API로 만들어야 안전하고,
 * 잔액 선점도 실제 함수를 거쳐 "돈은 거래 기록의 합계" 원칙을 지키기 위해서다.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/server/db/database.types.ts";
import {
  LARGE_MESSAGE_COUNT,
  seedCounts,
  seedMessage,
  UNIT_PRICE,
} from "./large-data.mts";

// 고정 id라 다시 실행하면 이전 데이터를 지우고 같은 구성으로 만든다.
const ORG_ID = "5eed0000-0000-4000-8000-000000000001";
const BRANCH_IDS = {
  seongsu: "5eed0000-0000-4000-8000-000000000011",
  mangwon: "5eed0000-0000-4000-8000-000000000012",
  hapjeong: "5eed0000-0000-4000-8000-000000000013",
};
const CAMPAIGN_ID = "5eed0000-0000-4000-8000-000000000021";
const PAYMENT_ID = "5eed0000-0000-4000-8000-000000000031";
const USERS = {
  hq: {
    id: "5eed0000-0000-4000-8000-000000000041",
    email: "seed-hq@example.com",
  },
  seongsu: {
    id: "5eed0000-0000-4000-8000-000000000042",
    email: "seed-seongsu@example.com",
  },
};
const BATCH_SIZE = 5_000;
const LOCAL_PASSWORD = "local-seed-password";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY가 필요하다 (.env.local)",
  );
}

// 이 스크립트는 고정 id의 본사를 지운다. 운영 DB에 실수로 돌지 않도록 명시적으로 허용해야만 원격에 접속한다.
// 원격에서는 공개 저장소에 적힌 비밀번호로 계정이 만들어지지 않게 비밀번호도 따로 받는다.
const isLocal = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const password = isLocal ? LOCAL_PASSWORD : process.env.SEED_PASSWORD;
if (!isLocal && process.env.SEED_ALLOW_REMOTE !== "1") {
  fail(
    `로컬이 아닌 DB다: ${url}\n의도한 경우에만 SEED_ALLOW_REMOTE=1을 붙인다.`,
  );
}
if (!password) fail("원격에서는 SEED_PASSWORD가 필요하다.");

const db = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function must<T>(
  label: string,
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) fail(`${label} 실패: ${error.message}`);
  return data;
}

async function createUser(user: { id: string; email: string }) {
  const { error } = await db.auth.admin.createUser({
    id: user.id,
    email: user.email,
    password,
    email_confirm: true,
  });
  if (error) fail(`${user.email} 생성 실패: ${error.message}`);
}

const startedAt = performance.now();

console.log("이전 측정 데이터 삭제");
await must("본사 삭제", db.from("organizations").delete().eq("id", ORG_ID));
for (const user of Object.values(USERS)) {
  // 처음 실행이면 사용자가 없어 실패한다. 없는 것이 목적이므로 결과를 보지 않는다.
  await db.auth.admin.deleteUser(user.id);
}

console.log("본사·지점·계정 생성");
await must(
  "본사",
  db.from("organizations").insert({ id: ORG_ID, name: "측정용 본사" }),
);
await must(
  "지점",
  db.from("branches").insert([
    { id: BRANCH_IDS.seongsu, org_id: ORG_ID, name: "성수점" },
    { id: BRANCH_IDS.mangwon, org_id: ORG_ID, name: "망원점" },
    { id: BRANCH_IDS.hapjeong, org_id: ORG_ID, name: "합정점" },
  ]),
);
await createUser(USERS.hq);
await createUser(USERS.seongsu);
await must(
  "구성원",
  db.from("members").insert([
    {
      user_id: USERS.hq.id,
      org_id: ORG_ID,
      branch_id: null,
      role: "hq",
      display_name: "측정 본사",
    },
    {
      user_id: USERS.seongsu.id,
      org_id: ORG_ID,
      branch_id: BRANCH_IDS.seongsu,
      role: "branch",
      display_name: "측정 성수",
    },
  ]),
);

const cost = LARGE_MESSAGE_COUNT * UNIT_PRICE;
const counts = seedCounts(LARGE_MESSAGE_COUNT);

// 큐 워커가 건드리지 않도록 이미 발송 중인 상태로 만든다. 결과가 남은 8%는 "확인 중" 표시 측정용이다.
await must(
  "발송 건",
  db.from("campaigns").insert({
    id: CAMPAIGN_ID,
    org_id: ORG_ID,
    branch_id: BRANCH_IDS.seongsu,
    body: "측정용 문자입니다",
    kind: "sms",
    is_ad: false,
    sender_phone: "01000000002",
    status: "sending",
    recipient_count: LARGE_MESSAGE_COUNT,
    unit_price: UNIT_PRICE,
    estimated_cost: cost,
    sent_count: LARGE_MESSAGE_COUNT,
    delivered_count: counts.delivered,
    failed_count: counts.failed,
    started_at: "2026-11-01T00:00:00Z",
  }),
);

// 잔액도 실제 경로로 만든다. 측정 화면의 잔액이 거래 기록과 어긋나면 안 된다.
await must(
  "결제",
  db.from("payments").insert({
    id: PAYMENT_ID,
    org_id: ORG_ID,
    branch_id: BRANCH_IDS.seongsu,
    order_id: `seed-${PAYMENT_ID}`,
    payment_key: `seed-${PAYMENT_ID}`,
    amount: cost + 1_000_000,
    status: "done",
    approved_at: "2026-11-01T00:00:00Z",
  }),
);
await must(
  "충전",
  db.from("ledger_entries").insert({
    org_id: ORG_ID,
    branch_id: BRANCH_IDS.seongsu,
    kind: "charge",
    amount: cost + 1_000_000,
    payment_id: PAYMENT_ID,
    idempotency_key: `charge:seed-${PAYMENT_ID}`,
  }),
);
await must(
  "잔액 선점",
  db.rpc("reserve_balance", {
    p_org_id: ORG_ID,
    p_branch_id: BRANCH_IDS.seongsu,
    p_campaign_id: CAMPAIGN_ID,
    p_amount: cost,
    p_idempotency_key: `reserve:${CAMPAIGN_ID}`,
  }),
);

const insertStartedAt = performance.now();
for (let start = 0; start < LARGE_MESSAGE_COUNT; start += BATCH_SIZE) {
  const rows = Array.from(
    { length: Math.min(BATCH_SIZE, LARGE_MESSAGE_COUNT - start) },
    (_, offset) => ({
      ...seedMessage(start + offset),
      campaign_id: CAMPAIGN_ID,
      org_id: ORG_ID, // 삽입 트리거가 발송 건 값으로 덮어쓴다. 생성 타입이 요구해서 넘긴다.
    }),
  );
  await must(`메시지 ${start}`, db.from("messages").insert(rows));
  process.stdout.write(
    `\r메시지 ${start + rows.length} / ${LARGE_MESSAGE_COUNT}`,
  );
}
console.log();

const { count } = await db
  .from("messages")
  .select("id", { count: "exact", head: true })
  .eq("campaign_id", CAMPAIGN_ID);
if (count !== LARGE_MESSAGE_COUNT) {
  fail(`행 수가 맞지 않는다: ${count}`);
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);
console.log(`완료: ${count}행`);
console.log(
  `메시지 저장 ${seconds(performance.now() - insertStartedAt)}초, 전체 ${seconds(performance.now() - startedAt)}초`,
);
console.log(`로그인: ${USERS.hq.email}, ${USERS.seongsu.email}`);
