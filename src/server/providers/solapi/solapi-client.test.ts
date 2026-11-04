// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSolapiClient } from "./solapi-client";
import { SolapiRejected } from "./solapi-provider";

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
    ).rejects.not.toBeInstanceOf(SolapiRejected);
  });

  it("4xx는 재시도하지 않게 업체 코드를 담아 돌려준다", async () => {
    stubFetch(403, { errorCode: "InvalidApiKey", errorMessage: "키 오류" });
    const error = await createSolapiClient("KEY", "SECRET")
      .send([message])
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SolapiRejected);
    expect((error as SolapiRejected).failCode).toBe("SOLAPI_InvalidApiKey");
  });

  it("호출 제한은 재시도한다", async () => {
    stubFetch(429, { errorCode: "TooManyRequests", errorMessage: "제한" });
    await expect(
      createSolapiClient("KEY", "SECRET").send([message]),
    ).rejects.not.toBeInstanceOf(SolapiRejected);
  });

  it("200인데 해석하지 못하면 접수됐을 수 있어 재시도하지 않는다", async () => {
    stubFetch(200, { unexpected: true });
    const error = await createSolapiClient("KEY", "SECRET")
      .send([message])
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SolapiRejected);
    expect((error as SolapiRejected).failCode).toBe("SOLAPI_NO_RESULT");
  });

  it("네트워크 오류는 재시도하도록 그대로 던진다", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      createSolapiClient("KEY", "SECRET").send([message]),
    ).rejects.not.toBeInstanceOf(SolapiRejected);
  });
});
