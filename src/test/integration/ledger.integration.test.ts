import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, must, rest, service, type Fixture } from "./fixture";

const INVALID_AMOUNT = "DH001";
const CAMPAIGN_ACCOUNT_MISMATCH = "DH002";
const IDEMPOTENCY_CONFLICT = "DH003";
const INSUFFICIENT_BALANCE = "DH004";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await f.cleanup();
});

/** 각 테스트가 잔액 1,000원인 새 지점 계정을 쓴다. 앞 테스트의 차감이 다음 테스트의 기대값을 바꾸지 않게 한다. */
async function createAccount(): Promise<string> {
  const { id: branchId } = must(
    await service
      .from("branches")
      .insert({ org_id: f.orgA, name: `계정-${crypto.randomUUID()}` })
      .select("id")
      .single(),
  );
  const orderId = crypto.randomUUID();
  const { id: paymentId } = must(
    await service
      .from("payments")
      .insert({
        org_id: f.orgA,
        branch_id: branchId,
        order_id: orderId,
        payment_key: orderId,
        amount: 1000,
        status: "done",
      })
      .select("id")
      .single(),
  );
  must(
    await service
      .from("ledger_entries")
      .insert({
        org_id: f.orgA,
        branch_id: branchId,
        kind: "charge",
        amount: 1000,
        payment_id: paymentId,
        idempotency_key: `charge:${orderId}`,
      })
      .select("id"),
  );
  return branchId;
}

async function createCampaigns(
  branchId: string | null,
  count: number,
): Promise<string[]> {
  const rows = must(
    await service
      .from("campaigns")
      .insert(
        Array.from({ length: count }, () => ({
          org_id: f.orgA,
          branch_id: branchId,
          body: "선점",
        })),
      )
      .select("id"),
  );
  return rows.map((row) => row.id);
}

function reserve(
  branchId: string | null,
  campaignId: string,
  amount: number,
  key: string,
) {
  return service.rpc("reserve_balance", {
    p_org_id: f.orgA,
    // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 계정은 null이 유효하다.
    p_branch_id: branchId as string,
    p_campaign_id: campaignId,
    p_amount: amount,
    p_idempotency_key: key,
  });
}

async function balanceOf(branchId: string): Promise<number> {
  const row = must(
    await service
      .from("account_balances")
      .select("balance")
      .eq("branch_id", branchId)
      .single(),
  );
  return row.balance ?? 0;
}

describe("reserve_balance", () => {
  it("차감하고 처리 후 잔액을 돌려준다", async () => {
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    const result = await reserve(account, campaign ?? "", 800, "first");

    expect(result.data).toBe(200);
    expect(await balanceOf(account)).toBe(200);
  });

  it("잔액과 정확히 같은 금액은 통과하고 1원이라도 넘으면 거부한다", async () => {
    const account = await createAccount();
    const [over, exact] = await createCampaigns(account, 2);

    const rejected = await reserve(account, over ?? "", 1001, "boundary-over");
    expect(rejected.error?.code).toBe(INSUFFICIENT_BALANCE);
    expect(await balanceOf(account)).toBe(1000);

    const accepted = await reserve(
      account,
      exact ?? "",
      1000,
      "boundary-exact",
    );
    expect(accepted.data).toBe(0);
  });

  it("같은 키로 다시 불러도 한 번만 차감한다", async () => {
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    await reserve(account, campaign ?? "", 300, "retry");
    const retried = await reserve(account, campaign ?? "", 300, "retry");

    expect(retried.error).toBeNull();
    expect(retried.data).toBe(700);
    expect(await balanceOf(account)).toBe(700);
  });

  it("잔액이 소진된 뒤 같은 키로 재시도해도 잔액 부족으로 실패하지 않는다", async () => {
    // 재시도는 "이미 성공한 요청"의 확인이다. 잔액 검사가 먼저 돌면 성공한 발송이 실패로 뒤집힌다.
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    await reserve(account, campaign ?? "", 1000, "drained");
    const retried = await reserve(account, campaign ?? "", 1000, "drained");

    expect(retried.error).toBeNull();
    expect(retried.data).toBe(0);
  });

  it("같은 키에 금액이 다르면 호출 코드의 버그로 보고 거부한다", async () => {
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    await reserve(account, campaign ?? "", 300, "conflict");
    const conflict = await reserve(account, campaign ?? "", 400, "conflict");

    expect(conflict.error?.code).toBe(IDEMPOTENCY_CONFLICT);
    expect(await balanceOf(account)).toBe(700);
  });

  it.each([0, -100])("금액 %d을 거부한다", async (amount) => {
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    const result = await reserve(
      account,
      campaign ?? "",
      amount,
      `invalid-${amount}`,
    );

    expect(result.error?.code).toBe(INVALID_AMOUNT);
  });

  it("다른 지점의 발송 건을 내 잔액으로 처리할 수 없다", async () => {
    const mine = await createAccount();
    const other = await createAccount();
    const [otherCampaign] = await createCampaigns(other, 1);

    const result = await reserve(mine, otherCampaign ?? "", 10, "mismatch");

    expect(result.error?.code).toBe(CAMPAIGN_ACCOUNT_MISMATCH);
    expect(await balanceOf(mine)).toBe(1000);
  });

  it("본사 발송 건을 지점 잔액으로, 지점 발송 건을 본사 잔액으로 처리할 수 없다", async () => {
    const branch = await createAccount();
    const [hqCampaign] = await createCampaigns(null, 1);
    const [branchCampaign] = await createCampaigns(branch, 1);

    const hqOnBranch = await reserve(
      branch,
      hqCampaign ?? "",
      10,
      "mismatch-hq-branch",
    );
    const branchOnHq = await reserve(
      null,
      branchCampaign ?? "",
      10,
      "mismatch-branch-hq",
    );

    expect(hqOnBranch.error?.code).toBe(CAMPAIGN_ACCOUNT_MISMATCH);
    expect(branchOnHq.error?.code).toBe(CAMPAIGN_ACCOUNT_MISMATCH);
  });

  it("본사 계정(branch_id null)에서도 지점 잔액을 건드리지 않고 차감한다", async () => {
    const branch = await createAccount();
    const [hqCampaign] = await createCampaigns(null, 1);

    const result = await reserve(null, hqCampaign ?? "", 100, "hq-account");

    expect(result.error).toBeNull();
    expect(result.data).toBe(900); // 픽스처의 본사 계정 충전 1,000원 기준
    expect(await balanceOf(branch)).toBe(1000);
  });
});

describe("동시 호출", () => {
  it("20건을 동시에 선점해도 잔액이 음수가 되지 않고 정확히 잔액만큼만 통과한다", async () => {
    const account = await createAccount();
    const campaigns = await createCampaigns(account, 20);

    const results = await Promise.all(
      campaigns.map((campaign, index) =>
        reserve(account, campaign, 100, `race-${account}-${index}`),
      ),
    );

    const accepted = results.filter((result) => result.error === null);
    const rejected = results.filter((result) => result.error !== null);

    expect(accepted).toHaveLength(10);
    expect(rejected.map((result) => result.error?.code)).toEqual(
      Array.from({ length: 10 }, () => INSUFFICIENT_BALANCE),
    );
    expect(await balanceOf(account)).toBe(0);
  });

  it("같은 키로 동시에 불러도 거래 기록은 한 건이다", async () => {
    const account = await createAccount();
    const [campaign] = await createCampaigns(account, 1);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserve(account, campaign ?? "", 100, `dup-${account}`),
      ),
    );

    expect(results.map((result) => result.error)).toEqual(
      Array.from({ length: 10 }, () => null),
    );
    expect(await balanceOf(account)).toBe(900);

    const entries = must(
      await service
        .from("ledger_entries")
        .select("id")
        .eq("branch_id", account)
        .eq("kind", "reserve"),
    );
    expect(entries).toHaveLength(1);
  });

  it("다른 계정의 선점은 서로의 잔액에 영향을 주지 않는다", async () => {
    const first = await createAccount();
    const second = await createAccount();
    const firstCampaigns = await createCampaigns(first, 5);
    const secondCampaigns = await createCampaigns(second, 5);

    await Promise.all([
      ...firstCampaigns.map((id, i) =>
        reserve(first, id, 100, `cross-${first}-${i}`),
      ),
      ...secondCampaigns.map((id, i) =>
        reserve(second, id, 50, `cross-${second}-${i}`),
      ),
    ]);

    expect(await balanceOf(first)).toBe(500);
    expect(await balanceOf(second)).toBe(750);
  });
});

describe("account_balances", () => {
  it("지점 사용자는 자기 계정 잔액만 본다", async () => {
    const { rows } = await rest(
      await f.tokenOf("branch1"),
      "GET",
      "account_balances?select=*",
    );
    expect(rows).toEqual([
      { org_id: f.orgA, branch_id: f.branch1, balance: 1000 },
    ]);
  });
});
