import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER = "tosspayments-webhook-signature";
const TIME_HEADER = "tosspayments-webhook-transmission-time";

/**
 * 문서: HMAC-SHA256({본문}:{전송 시각})을 보안 키로 만들어 v1: 값들과 비교한다.
 * missing을 invalid와 나눈다. 결제 상태 이벤트에 헤더가 실제로 오는지 문서만으로 확신할 수 없어
 * 기록으로 확인하려는 것이다. 어느 쪽이든 충전 여부는 조회 API 결과로만 정하므로 위조로 충전되지 않는다.
 */
export function verifyTossSignature(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
): "valid" | "invalid" | "missing" {
  const signature = headers.get(SIGNATURE_HEADER);
  const time = headers.get(TIME_HEADER);
  if (!secret || !signature || !time) return "missing";

  const expected = createHmac("sha256", secret)
    .update(`${rawBody}:${time}`)
    .digest();
  const matched = signature.split(",").some((part) => {
    const value = part.trim();
    if (!value.startsWith("v1:")) return false;
    const actual = Buffer.from(value.slice(3), "base64");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
  return matched ? "valid" : "invalid";
}
