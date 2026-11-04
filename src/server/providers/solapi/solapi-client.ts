import {
  BadRequestError,
  MessageNotReceivedError,
  SolapiMessageService,
} from "solapi";
import {
  SolapiBadRequest,
  type SolapiClient,
  type SolapiMessage,
} from "./solapi-provider.ts";

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
        if (cause instanceof BadRequestError) {
          throw new SolapiBadRequest(cause.message);
        }
        throw cause;
      }
    },
  };
}
