import {
  BadRequestError,
  ClientError,
  DefaultError,
  MessageNotReceivedError,
  NetworkError,
  ServerError,
  SolapiMessageService,
} from "solapi";
import {
  SolapiRejected,
  type SolapiClient,
  type SolapiMessage,
} from "./solapi-provider.ts";

const TOO_MANY_REQUESTS = 429;
/** SDK가 자체 재시도까지 실패한 뒤 내는 코드. 이것만 요청이 처리되지 않았다고 볼 수 있는 DefaultError다. */
const RETRY_FAILED_CODE = "RequestFailedAfterRetryError";

/**
 * 재시도해도 되는 오류를 적어 둔다. 금지 목록으로 쓰면 SDK의 예상 밖 예외가 재시도로 흘러가는데,
 * 200을 받고 해석에서 터진 경우라면 이미 접수된 문자를 다시 보내게 된다.
 */
function isRetryable(cause: unknown): boolean {
  if (cause instanceof NetworkError || cause instanceof ServerError) {
    return true;
  }
  if (cause instanceof ClientError) {
    return cause.httpStatus === TOO_MANY_REQUESTS;
  }
  return cause instanceof DefaultError && cause.errorCode === RETRY_FAILED_CODE;
}

/** SDK를 불러오는 유일한 파일. SDK의 예외를 어댑터가 이해하는 형태로 바꾼다. */
export function createSolapiClient(
  apiKey: string,
  apiSecret: string,
): SolapiClient {
  const service = new SolapiMessageService(apiKey, apiSecret);

  return {
    async send(messages: readonly SolapiMessage[]) {
      try {
        return await service.send([...messages], {
          // 건별 messageId를 받으려면 필요하다. 없으면 접수 건을 웹훅과 이을 수 없다.
          showMessageList: true,
          // 다른 발송 건의 같은 번호가 한 묶음에 들어올 수 있다. 발송 건 안의 중복은 DB 유일 제약이 이미 막는다.
          allowDuplicates: true,
        });
      } catch (cause) {
        // 모든 건이 거절되면 응답 대신 예외가 온다. 건별 사유가 들어 있으므로 일반 응답처럼 처리한다.
        if (cause instanceof MessageNotReceivedError) {
          return { failedMessageList: cause.failedMessageList };
        }
        if (isRetryable(cause)) throw cause;
        if (cause instanceof BadRequestError) {
          throw new SolapiRejected("SOLAPI_BAD_REQUEST", cause.message);
        }
        // 인증 실패, 미등록 발신번호, 잔액 부족 같은 4xx는 다시 보내도 같다.
        // 재시도하면 1시간 가까이 "대기"로 남아 원인이 가려진다.
        if (cause instanceof ClientError) {
          throw new SolapiRejected(
            `SOLAPI_${cause.errorCode}`,
            cause.errorMessage,
          );
        }
        // 나머지는 응답을 해석하지 못한 경우다. 접수됐을 수 있어 다시 보내지 않는다.
        throw new SolapiRejected(
          "SOLAPI_NO_RESULT",
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
  };
}
