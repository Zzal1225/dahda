import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import { createFixture, must, service, type Fixture } from "./fixture";

// campaign_trend가 KST 날짜로 칸을 나누고, 나간 건만 세며, RLS 범위를 지키는지 본다.
// 빈 칸 채우기와 비율은 trend.test.ts가 맡는다. 여기서는 DB가 주는 숫자만 본다.
// 다른 테스트의 발송 건과 섞이지 않게 2001년에 시작한 건만 만들고, 결과도 2001년 칸만 읽는다.

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

type Seed = {
  branch: "branch1" | "branch2";
  status: Database["public"]["Enums"]["campaign_status"];
  startedAt: string;
  recipients: number;
  sent: number;
  delivered: number;
  failed: number;
};

async function seed(rows: Seed[]) {
  must(
    await service
      .from("campaigns")
      .insert(
        rows.map((row) => ({
          org_id: f.orgA,
          branch_id: f[row.branch],
          body: "추이 시험",
          sender_phone: "01000000001",
          status: row.status,
          started_at: row.startedAt,
          recipient_count: row.recipients,
          sent_count: row.sent,
          delivered_count: row.delivered,
          failed_count: row.failed,
          rejected_reason: row.status === "rejected" ? "시험" : null,
        })),
      )
      .select("id"),
  );
}

async function trend(
  user: Parameters<Fixture["tokenOf"]>[0],
  unit: string,
): Promise<
  Database["public"]["Functions"]["campaign_trend"]["Returns"][number][]
> {
  const rows = must(
    await (
      await asUser(user)
    ).rpc("campaign_trend", {
      p_from: "2001-01-01T00:00:00Z",
      p_unit: unit,
    }),
  );
  return rows.filter((row) => row.bucket.startsWith("2001-"));
}

beforeAll(async () => {
  f = await createFixture();
  await seed([
    // UTC 3/1 14:59:59 = KST 3/1 23:59:59 → 3월 1일 칸
    {
      branch: "branch1",
      status: "completed",
      startedAt: "2001-03-01T14:59:59Z",
      recipients: 10,
      sent: 10,
      delivered: 7,
      failed: 1,
    },
    // UTC 3/1 15:00 = KST 3/2 00:00 → 3월 2일 칸
    {
      branch: "branch1",
      status: "sending",
      startedAt: "2001-03-01T15:00:00Z",
      recipients: 5,
      sent: 4,
      delivered: 1,
      failed: 0,
    },
    {
      branch: "branch2",
      status: "completed",
      startedAt: "2001-03-02T03:00:00Z",
      recipients: 20,
      sent: 20,
      delivered: 20,
      failed: 0,
    },
    // 나가지 않은(또는 중간에 멈춘) 건은 세지 않는다.
    {
      branch: "branch1",
      status: "canceled",
      startedAt: "2001-03-02T03:00:00Z",
      recipients: 100,
      sent: 0,
      delivered: 0,
      failed: 0,
    },
  ]);
});

afterAll(async () => {
  await f.cleanup();
});

describe("campaign_trend", () => {
  it("본사는 전 지점을 KST 날짜 칸으로 모아 본다", async () => {
    expect(await trend("hq", "day")).toEqual([
      {
        bucket: "2001-03-01",
        campaign_count: 1,
        recipient_count: 10,
        delivered: 7,
        // 확인 중 = 업체가 받았지만 결과가 없는 수(10 - 7 - 1)
        pending: 2,
        failed: 1,
      },
      {
        bucket: "2001-03-02",
        campaign_count: 2,
        recipient_count: 25,
        delivered: 21,
        // 지점1 4 - 1 - 0 = 3, 지점2 0
        pending: 3,
        failed: 0,
      },
    ]);
  });

  it("월별은 1일을 칸으로 합친다", async () => {
    expect(await trend("hq", "month")).toEqual([
      {
        bucket: "2001-03-01",
        campaign_count: 3,
        recipient_count: 35,
        delivered: 28,
        pending: 5,
        failed: 1,
      },
    ]);
  });

  it("지점은 자기 지점 건만 센다", async () => {
    const rows = await trend("branch2", "day");
    expect(rows).toEqual([
      expect.objectContaining({ bucket: "2001-03-02", recipient_count: 20 }),
    ]);
  });

  it("다른 본사는 아무것도 보지 못한다", async () => {
    expect(await trend("otherHq", "day")).toEqual([]);
  });

  it("정해지지 않은 단위는 오류 대신 빈 결과다", async () => {
    expect(await trend("hq", "week")).toEqual([]);
  });

  it("로그인하지 않은 사용자는 부를 수 없다", async () => {
    const anon = createClient<Database>(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await anon.rpc("campaign_trend", {
      p_from: "2001-01-01T00:00:00Z",
      p_unit: "day",
    });
    expect(error?.code).toBe("42501");
  });
});
