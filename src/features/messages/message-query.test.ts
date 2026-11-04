import { describe, expect, it } from "vitest";
import { messageQuerySchema } from "./message-query";

const campaignId = "5eed0000-0000-4000-8000-000000000021";

describe("messageQuerySchema", () => {
  it("기본값을 채운다", () => {
    expect(messageQuerySchema.parse({ campaignId })).toEqual({
      campaignId,
      status: [],
      q: "",
      offset: 0,
      limit: 100,
      withTotal: false,
    });
  });

  it("URL의 문자열 숫자를 숫자로 바꾼다", () => {
    const parsed = messageQuerySchema.parse({
      campaignId,
      offset: "200",
      limit: "500",
    });
    expect(parsed).toMatchObject({ offset: 200, limit: 500 });
  });

  it.each([
    { name: "발송 건 id 형식", input: { campaignId: "abc" } },
    { name: "음수 offset", input: { campaignId, offset: -1 } },
    { name: "0건 요청", input: { campaignId, limit: 0 } },
    { name: "응답 상한 초과", input: { campaignId, limit: 1001 } },
    { name: "없는 상태", input: { campaignId, status: ["hacked"] } },
    { name: "숫자가 아닌 검색어", input: { campaignId, q: "010%" } },
    { name: "너무 긴 검색어", input: { campaignId, q: "1".repeat(16) } },
  ])("$name을 거부한다", ({ input }) => {
    expect(messageQuerySchema.safeParse(input).success).toBe(false);
  });
});
