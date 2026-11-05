import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseQueueStore } from "@/server/queue/supabase-store";
import { createFixture, must, service, type Fixture } from "./fixture";

const SENDER = "01000000000";
const BODY = "고정 본문";
const created: { user: string; org: string }[] = [];
let f: Fixture;

/** 체험 사용자는 실제 경로와 같이 create_trial_org로 만든다. */
async function createTrialUser() {
  const { data, error } = await service.auth.admin.createUser({
    email: `demo-${randomUUID()}@example.com`,
    email_confirm: true,
  });
  if (error) throw error;
  const user = data.user.id;
  const org = must(await service.rpc("create_trial_org", { p_user_id: user }));
  created.push({ user, org });
  return { user, org };
}

const uniquePhone = () =>
  `010${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`;

const start = (
  trial: { user: string; org: string },
  phone: string,
  options: { unitPrice?: number; dailyLimit?: number } = {},
) =>
  service.rpc("start_demo_send", {
    p_user_id: trial.user,
    p_org_id: trial.org,
    p_branch_id: null as unknown as string,
    p_phone: phone,
    p_sender_phone: SENDER,
    p_body: BODY,
    p_unit_price: options.unitPrice ?? 20,
    p_daily_limit: options.dailyLimit ?? 10_000,
  });

beforeAll(async () => {
  f = await createFixture();
  await service.from("messages").delete().eq("status", "queued");
});
afterAll(async () => {
  await f.cleanup();
  // 대기 메시지를 남기면 뒤 파일의 큐 테스트가 그 행을 집는다. 실제 정리 경로로 지운다.
  await service
    .from("organizations")
    .update({ trial_expires_at: "2000-01-01T00:00:00Z" })
    .in(
      "id",
      created.map(({ org }) => org),
    );
  await service.rpc("delete_expired_trials");
});

describe("start_demo_send", () => {
  it("플래그가 켜진 고정 본문 발송 건을 만들고 금액을 선점한다", async () => {
    const trial = await createTrialUser();
    const phone = uniquePhone();
    const id = must(await start(trial, phone));

    const campaign = must(
      await service
        .from("campaigns")
        .select("is_real_demo, body, is_ad, kind, status, sender_phone")
        .eq("id", id)
        .single(),
    );
    expect(campaign).toEqual({
      is_real_demo: true,
      body: BODY,
      is_ad: false,
      kind: "sms",
      status: "scheduled",
      sender_phone: SENDER,
    });
    const reserve = must(
      await service
        .from("ledger_entries")
        .select("amount")
        .eq("campaign_id", id)
        .eq("kind", "reserve"),
    );
    expect(reserve).toEqual([{ amount: -20 }]);
  });

  it("워커가 플래그를 받는다. 일반 체험 발송은 꺼져 있다", async () => {
    const store = createSupabaseQueueStore(service);
    await service.from("messages").delete().eq("status", "queued");
    const trial = await createTrialUser();
    const id = must(await start(trial, uniquePhone()));
    const normal = must(
      await service.rpc("submit_campaign", {
        p_client_request_id: randomUUID(),
        p_org_id: trial.org,
        p_branch_id: null as unknown as string,
        p_created_by: trial.user,
        p_body: "일반",
        p_kind: "sms",
        p_is_ad: false,
        p_sender_phone: SENDER,
        p_status: "scheduled",
        p_scheduled_at: null as unknown as string,
        p_unit_price: 1,
        p_recipients: [{ phone: uniquePhone(), name: null }],
      }),
    );

    const claimed = await store.claim(100, 300);
    expect(claimed.find((row) => row.campaignId === id)?.isRealDemo).toBe(true);
    expect(claimed.find((row) => row.campaignId === normal)?.isRealDemo).toBe(
      false,
    );
  });

  it("체험 계정 하나에 1건뿐이다", async () => {
    const trial = await createTrialUser();
    must(await start(trial, uniquePhone()));
    const again = await start(trial, uniquePhone());
    expect(again.error?.code).toBe("DH016");
  });

  it("같은 번호는 다른 체험 계정에서도 다시 받지 않는다", async () => {
    const phone = uniquePhone();
    must(await start(await createTrialUser(), phone));
    const again = await start(await createTrialUser(), phone);
    expect(again.error?.code).toBe("DH017");
  });

  it("번호를 평문으로 남기지 않는다", async () => {
    const trial = await createTrialUser();
    const phone = uniquePhone();
    must(await start(trial, phone));
    const row = must(
      await service
        .from("demo_sends")
        .select("phone_hash")
        .eq("user_id", trial.user)
        .single(),
    );
    expect(row.phone_hash).not.toContain(phone);
  });

  it("체험이 아닌 계정은 쓸 수 없다", async () => {
    const result = await start(
      { user: f.users.hq.id, org: f.orgA },
      uniquePhone(),
    );
    expect(result.error?.code).toBe("DH014");
  });

  it("다른 본사를 지정할 수 없다", async () => {
    const trial = await createTrialUser();
    const result = await start(
      { user: trial.user, org: f.orgA },
      uniquePhone(),
    );
    expect(result.error?.code).toBe("DH014");
  });

  it("잔액이 부족하면 기회를 쓰지 않는다", async () => {
    const trial = await createTrialUser();
    const failed = await start(trial, uniquePhone(), {
      unitPrice: 2_000_000_000,
    });
    expect(failed.error?.code).toBe("DH004");
    must(await start(trial, uniquePhone()));
  });

  it("오늘 상한을 다 쓰면 접수하지 않는다", async () => {
    const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const { data: before } = await service
      .from("real_send_counters")
      .select("sent")
      .eq("day", day)
      .maybeSingle();
    must(
      await service
        .from("real_send_counters")
        .upsert({ day, sent: 10 })
        .select("day"),
    );
    const result = await start(await createTrialUser(), uniquePhone(), {
      dailyLimit: 10,
    });
    must(
      await service
        .from("real_send_counters")
        .upsert({ day, sent: before?.sent ?? 0 })
        .select("day"),
    );
    expect(result.error?.code).toBe("DH015");
  });

  it("실패한 체험 문자는 재발송 대상이 아니다", async () => {
    const trial = await createTrialUser();
    const id = must(await start(trial, uniquePhone()));
    const [message] = must(
      await service
        .from("messages")
        .update({
          status: "failed",
          fail_code: "SOLAPI_TEST",
          finalized_at: new Date().toISOString(),
        })
        .eq("campaign_id", id)
        .select("id"),
    );
    const preview = must(
      await service.rpc("preview_retry", {
        p_source_id: id,
        p_org_id: trial.org,
        p_message_ids: [message?.id ?? 0],
        p_hopeless_codes: [],
      }),
    );
    expect(preview[0]?.target_count).toBe(0);
  });
});
