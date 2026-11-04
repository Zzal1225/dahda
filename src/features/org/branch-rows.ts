export type BranchRow = {
  id: string;
  name: string;
  accountName: string | null;
  balance: number;
};

/** 세 조회 결과를 표의 행으로 합친다. 거래 기록이 없는 지점은 뷰에 행이 없으므로 0원이다. */
export function buildBranchRows(
  branches: readonly { id: string; name: string }[],
  members: readonly { branch_id: string | null; display_name: string }[],
  balances: readonly { branch_id: string | null; balance: number | null }[],
): BranchRow[] {
  const accountByBranch = new Map(
    members.map((m) => [m.branch_id, m.display_name]),
  );
  const balanceByBranch = new Map(
    balances.map((b) => [b.branch_id, b.balance ?? 0]),
  );

  return branches
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      accountName: accountByBranch.get(branch.id) ?? null,
      balance: balanceByBranch.get(branch.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
