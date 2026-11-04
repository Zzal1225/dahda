import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBranchAccount } from "@/features/org/branch-account";
import { createFixture, must, service, type Fixture } from "./fixture";

let f: Fixture;
const createdEmails: string[] = [];

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  const created = data.users.filter((u) =>
    createdEmails.includes(u.email ?? ""),
  );
  await f.cleanup();
  await Promise.all(created.map((u) => service.auth.admin.deleteUser(u.id)));
});

function accountInput() {
  const email = `branch-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return { displayName: "새 담당", email, password: "local-test-password" };
}

async function newBranch(orgId: string) {
  return must(
    await service
      .from("branches")
      .insert({ org_id: orgId, name: `지점-${randomUUID()}` })
      .select("id")
      .single(),
  ).id;
}

describe("createBranchAccount", () => {
  it("로그인할 수 있는 지점 역할 계정을 만든다", async () => {
    const branchId = await newBranch(f.orgA);
    const input = accountInput();

    const failure = await createBranchAccount(service, f.orgA, branchId, input);

    expect(failure).toBeNull();
    const member = must(
      await service
        .from("members")
        .select("org_id, role, display_name")
        .eq("branch_id", branchId)
        .single(),
    );
    expect(member).toEqual({
      org_id: f.orgA,
      role: "branch",
      display_name: "새 담당",
    });
  });

  it("담당자가 있는 지점에는 만들지 않는다", async () => {
    const input = accountInput();

    const failure = await createBranchAccount(
      service,
      f.orgA,
      f.branch1,
      input,
    );

    expect(failure).toBe("already_assigned");
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === input.email)).toBe(false);
  });

  it("다른 본사의 지점에는 만들 수 없다", async () => {
    const branchId = await newBranch(f.orgB);

    const failure = await createBranchAccount(
      service,
      f.orgA,
      branchId,
      accountInput(),
    );

    expect(failure).toBe("branch_not_found");
  });

  it("이미 쓰는 이메일은 거부하고 지점은 비어 있는 채로 둔다", async () => {
    const branchId = await newBranch(f.orgA);

    const failure = await createBranchAccount(service, f.orgA, branchId, {
      ...accountInput(),
      email: f.users.hq.email,
    });

    expect(failure).toBe("email_taken");
    const members = must(
      await service.from("members").select("user_id").eq("branch_id", branchId),
    );
    expect(members).toEqual([]);
  });

  it("동시에 지정해도 한 명만 성공하고 나머지 사용자는 남지 않는다", async () => {
    const branchId = await newBranch(f.orgA);
    const inputs = Array.from({ length: 4 }, accountInput);

    const results = await Promise.all(
      inputs.map((input) =>
        createBranchAccount(service, f.orgA, branchId, input),
      ),
    );

    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "already_assigned")).toHaveLength(3);

    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const left = data.users.filter((u) =>
      inputs.some((i) => i.email === u.email),
    );
    expect(left).toHaveLength(1);
  });
});
