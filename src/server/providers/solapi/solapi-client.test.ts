// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSolapiClient } from "./solapi-client";
import { SolapiBadRequest } from "./solapi-provider";

/**
 * 실제 SDK에 네트워크만 바꿔 끼운다. SDK 버전이 바뀌어도 요청 형식과 예외 처리가 맞는지 본다.
 * 실제 서버 응답을 따라 한 것이 아니므로, 응답 형식의 최종 확인은 실제 1건 발송으로 한다.
 */
const message = {
  to: "01012345678",
  from: "01012345678",
  text: "본문",
  type: "SMS" as const,
  customFields: { k: "key-1" },
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSolapiClient", () => {
  it("HMAC 인증과 우리 설정으로 여러 건 발송 API를 부른다", async () => {
    const fetchMock = stubFetch(500, { errorCode: "x", errorMessage: "x" });

    await createSolapiClient("KEY", "SECRET")
      .send([message])
      .catch(() => {});

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
    expect(
      String((init?.headers as Record<string, string>).Authorization),
    ).toMatch(/^HMAC-SHA256 apiKey=KEY, date=.+, salt=.+, signature=.+/);
    const body = JSON.parse(String(init?.body)) as {
      messages: { customFields: unknown; text: string }[];
      showMessageList: boolean;
      allowDuplicates: boolean;
    };
    expect(body.messages[0]?.customFields).toEqual({ k: "key-1" });
    expect(body.messages[0]?.text).toBe("본문");
    expect(body.showMessageList).toBe(true);
    expect(body.allowDuplicates).toBe(true);
  });

  it("서버 오류는 던져 재시도로 넘긴다", async () => {
    stubFetch(500, { errorCode: "InternalError", errorMessage: "오류" });
    await expect(
      createSolapiClient("KEY", "SECRET").send([message]),
    ).rejects.not.toBeInstanceOf(SolapiBadRequest);
  });

  it("네트워크 오류도 던진다", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      createSolapiClient("KEY", "SECRET").send([message]),
    ).rejects.toBeDefined();
  });
});
