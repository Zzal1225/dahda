import { describe, expect, it } from "vitest";
import { senderNameOf } from "./compose-config";

describe("senderNameOf", () => {
  it("지점은 브랜드와 지점명을 쓴다", () => {
    expect(
      senderNameOf({ orgName: "dahda마트 본사", branchName: "성수점" }),
    ).toBe("dahda마트 성수점");
  });

  it("본사는 브랜드만 쓴다", () => {
    expect(senderNameOf({ orgName: "dahda마트 본사", branchName: null })).toBe(
      "dahda마트",
    );
  });

  it("본사라는 말이 없는 이름은 그대로 둔다", () => {
    expect(senderNameOf({ orgName: "측정용", branchName: null })).toBe(
      "측정용",
    );
  });
});
