import { describe, expect, it } from "vitest";
import {
  adPrefix,
  adSuffix,
  byteLength,
  campaignSchema,
  composeBody,
  deriveMessage,
  isNightKst,
  messageKind,
  NIGHT_MESSAGE,
  type CampaignInput,
} from "./campaignSchema";

const parts = {
  prefix: "(광고)dahda마트 010-0000-0001",
  suffix: "무료거부 080-000-0000",
};
// KST 2026-11-04 10:00
const NOW = new Date("2026-11-04T01:00:00Z");
const schema = campaignSchema({ ...parts, now: () => NOW });

const valid: CampaignInput = {
  clientRequestId: "5eed0000-0000-4000-8000-000000000001",
  groupIds: ["5eed0000-0000-4000-8000-000000000002"],
  contactIds: [],
  phones: [],
  isAd: false,
  body: "안녕하세요",
  senderId: "5eed0000-0000-4000-8000-000000000003",
  sendMode: "now",
  scheduledDay: "",
  scheduledTime: "",
};

function errorsOf(patch: Partial<CampaignInput>): Record<string, string> {
  const result = schema.safeParse({ ...valid, ...patch });
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [
      String(issue.path[0]),
      issue.message,
    ]),
  );
}

describe("byteLength", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["1 2", 3],
    ["\n", 1],
    ["가", 2],
    ["가a", 3],
    ["😀", 2],
    ["·", 2],
  ])("%j → %d", (text, bytes) => {
    expect(byteLength(text)).toBe(bytes);
  });
});

describe("messageKind", () => {
  it.each([
    [0, "sms"],
    [90, "sms"],
    [91, "lms"],
    [2000, "lms"],
  ])("%d byte → %s", (bytes, kind) => {
    expect(messageKind(bytes)).toBe(kind);
  });
});

describe("광고 문구", () => {
  it("앞부분은 (광고), 명칭, 전화번호 순서다", () => {
    expect(adPrefix("dahda마트 성수점", "010-0000-0002")).toBe(
      "(광고)dahda마트 성수점 010-0000-0002",
    );
  });

  it("명칭의 괄호류를 뺀다(업체 기준)", () => {
    expect(adPrefix("[dahda]마트", "1588-1234")).toBe(
      "(광고)dahda마트 1588-1234",
    );
  });

  it("끝부분에 무료 표시와 번호가 있다", () => {
    expect(adSuffix("080-000-0000")).toBe("무료거부 080-000-0000");
  });

  it("광고는 시작과 끝에 넣고, 비광고는 그대로 둔다", () => {
    expect(composeBody("본문", true, parts)).toBe(
      "(광고)dahda마트 010-0000-0001\n본문\n무료거부 080-000-0000",
    );
    expect(composeBody("본문", false, parts)).toBe("본문");
  });
});

describe("deriveMessage", () => {
  it("광고 문구까지 포함해 종류와 단가를 정한다", () => {
    const body = "a".repeat(80);
    expect(deriveMessage({ body, isAd: false }, parts)).toMatchObject({
      kind: "sms",
      unitPrice: 20,
    });
    // 비광고로는 SMS지만 고정 문구를 더하면 90byte를 넘는다.
    expect(deriveMessage({ body, isAd: true }, parts)).toMatchObject({
      kind: "lms",
      unitPrice: 50,
    });
  });

  it("90byte 경계에서 단가가 바뀐다", () => {
    expect(
      deriveMessage({ body: "a".repeat(90), isAd: false }, parts).unitPrice,
    ).toBe(20);
    expect(
      deriveMessage({ body: "a".repeat(91), isAd: false }, parts).unitPrice,
    ).toBe(50);
  });
});

describe("isNightKst", () => {
  // UTC로 준 시각을 KST로 판단한다.
  it.each([
    ["2026-11-04T11:59:00Z", "20:59", false],
    ["2026-11-04T12:00:00Z", "21:00", true],
    ["2026-11-04T22:59:00Z", "07:59", true],
    ["2026-11-04T23:00:00Z", "08:00", false],
    ["2026-11-04T15:00:00Z", "00:00", true],
  ])("%s (KST %s) → %s", (iso, _, expected) => {
    expect(isNightKst(new Date(iso))).toBe(expected);
  });
});

describe("campaignSchema", () => {
  it("올바른 입력을 통과시키고 값을 바꾸지 않는다", () => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  it("검사를 통과한 값을 다시 검사해도 같다", () => {
    expect(schema.parse(schema.parse(valid))).toEqual(valid);
  });

  describe("받는 사람", () => {
    it("아무도 고르지 않으면 안내한다", () => {
      expect(errorsOf({ groupIds: [], contactIds: [] }).groupIds).toBe(
        "받는 사람을 1명 이상 선택해 주세요",
      );
    });

    it("주소록에서만 골라도 된다", () => {
      expect(
        errorsOf({
          groupIds: [],
          contactIds: ["5eed0000-0000-4000-8000-000000000004"],
        }),
      ).toEqual({});
    });

    it("직접 입력한 번호만 있어도 된다", () => {
      expect(
        errorsOf({ groupIds: [], contactIds: [], phones: ["01012345678"] }),
      ).toEqual({});
    });

    // 화면이 정규화해서 보낸다. 하이픈이 남은 값은 다른 번호로 저장될 수 있어 서버가 받지 않는다.
    it.each(["010-1234-5678", "0101234567", "abc"])(
      "정규화되지 않은 번호 %j를 거부한다",
      (phone) => {
        expect(errorsOf({ phones: [phone] }).phones).toBe(
          "형식이 틀린 번호가 있어요",
        );
      },
    );

    it("직접 입력은 1,000개까지다", () => {
      const phones = (count: number) =>
        Array.from(
          { length: count },
          (_, index) => `010${String(index).padStart(8, "0")}`,
        );
      expect(errorsOf({ phones: phones(1_000) }).phones).toBeUndefined();
      expect(errorsOf({ phones: phones(1_001) }).phones).toBe(
        "직접 입력은 1,000개까지예요",
      );
    });
  });

  describe("내용", () => {
    it.each(["", "   ", "\n"])("빈 내용 %j를 거부한다", (body) => {
      expect(errorsOf({ body }).body).toBe("보낼 내용을 입력해 주세요");
    });

    it("2,000byte까지 통과하고 넘으면 거부한다", () => {
      expect(errorsOf({ body: "a".repeat(2000) }).body).toBeUndefined();
      expect(errorsOf({ body: "a".repeat(2001) }).body).toBe(
        "2,000byte를 넘을 수 없어요",
      );
    });

    it("한글은 2byte로 센다", () => {
      expect(errorsOf({ body: "가".repeat(1000) }).body).toBeUndefined();
      expect(errorsOf({ body: "가".repeat(1001) }).body).toBeDefined();
    });

    it("광고는 고정 문구까지 합쳐 2,000byte를 본다", () => {
      expect(
        errorsOf({ body: "a".repeat(2000), isAd: true }).body,
      ).toBeDefined();
    });
  });

  it("발신번호가 없으면 거부한다", () => {
    expect(errorsOf({ senderId: "" }).senderId).toBe(
      "발신번호를 선택해 주세요",
    );
  });

  describe("예약", () => {
    const scheduled = (
      scheduledDay: string,
      scheduledTime: string,
      isAd = false,
    ) => errorsOf({ sendMode: "scheduled", scheduledDay, scheduledTime, isAd });

    it("앞으로의 시각을 통과시킨다", () => {
      expect(scheduled("2026-11-04", "11:00")).toEqual({});
    });

    it("시각을 고르지 않으면 안내한다", () => {
      expect(scheduled("", "").scheduledTime).toBe(
        "보낼 날짜와 시각을 선택해 주세요",
      );
    });

    it.each([
      ["없는 날짜", "2026-13-40", "10:00"],
      ["없는 시각", "2026-11-04", "25:00"],
      ["형식 오류", "abc", "10:00"],
    ])("%s를 거부한다", (_, day, time) => {
      expect(scheduled(day, time).scheduledTime).toBe(
        "보낼 날짜와 시각을 선택해 주세요",
      );
    });

    it.each([
      ["과거", "2026-11-04", "09:00"],
      ["지금", "2026-11-04", "10:00"],
    ])("%s는 거부한다", (_, day, time) => {
      expect(scheduled(day, time).scheduledTime).toBe(
        "지금보다 뒤의 시각을 선택해 주세요",
      );
    });

    it("7일 경계", () => {
      expect(scheduled("2026-11-11", "10:00")).toEqual({});
      expect(scheduled("2026-11-11", "10:30").scheduledTime).toBe(
        "7일 안의 시각을 선택해 주세요",
      );
    });

    it.each([
      ["20:30", false],
      ["21:00", true],
      ["23:30", true],
    ])("광고를 %s에 예약하면 야간 차단 %s", (time, blocked) => {
      expect(scheduled("2026-11-04", time, true).scheduledTime).toBe(
        blocked ? NIGHT_MESSAGE : undefined,
      );
    });

    it.each([
      ["07:30", true],
      ["08:00", false],
    ])("다음 날 %s 광고 야간 차단 %s", (time, blocked) => {
      expect(scheduled("2026-11-05", time, true).scheduledTime).toBe(
        blocked ? NIGHT_MESSAGE : undefined,
      );
    });

    it("비광고는 야간에도 예약할 수 있다", () => {
      expect(scheduled("2026-11-04", "23:30")).toEqual({});
    });
  });

  describe("지금 보내기", () => {
    // KST 2026-11-04 22:00
    const atNight = campaignSchema({
      ...parts,
      now: () => new Date("2026-11-04T13:00:00Z"),
    });

    it("야간에는 광고를 지금 보낼 수 없다", () => {
      const result = atNight.safeParse({ ...valid, isAd: true });
      expect(result.error?.issues[0]?.message).toBe(NIGHT_MESSAGE);
    });

    it("야간에도 비광고는 보낼 수 있다", () => {
      expect(atNight.safeParse(valid).success).toBe(true);
    });

    it("낮에는 광고를 보낼 수 있다", () => {
      expect(errorsOf({ isAd: true })).toEqual({});
    });
  });
});
