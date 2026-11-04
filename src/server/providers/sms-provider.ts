/**
 * 문자 업체를 바꿔 끼우는 경계. 워커와 웹훅은 이 타입만 알고, 업체 SDK는 구현 폴더 밖으로 나오지 않는다.
 *
 * 필드는 "업체가 무엇을 주는가"가 아니라 "우리 상태 전이에 무엇이 필요한가"를 기준으로 정했다.
 * 솔라피의 실제 필드는 step4에서 공식 문서를 확인해 구현체 안에서 이 형태로 바꾼다.
 */

export type SendRequest = {
  /** 재시도에도 같은 값. 업체 쪽 중복 발송을 막고, 먼저 온 웹훅을 메시지 행과 잇는 데 쓴다. */
  idempotencyKey: string;
  to: string;
  from: string;
  body: string;
  kind: "sms" | "lms";
};

export type SendResult =
  | { idempotencyKey: string; outcome: "accepted"; providerMessageId: string }
  | {
      idempotencyKey: string;
      outcome: "rejected";
      failCode: string;
      /** true면 일시 오류(네트워크·5xx·점검)라 큐가 다시 시도하고, false면 영구 오류라 바로 failed로 확정한다. */
      retryable: boolean;
    };

/** 스트림인 Request 대신 원문 문자열을 받는다. 서명 검증·원문 저장·파싱이 모두 같은 원문을 읽어야 하기 때문이다. */
export type WebhookRequest = {
  rawBody: string;
  headers: Headers;
};

export type WebhookEvent = {
  providerMessageId: string;
  /** 업체가 돌려주지 않으면 null이다. 그때는 providerMessageId로 메시지를 찾는다. */
  idempotencyKey: string | null;
  occurredAt: Date;
} & ({ status: "delivered" } | { status: "failed"; failCode: string });

export interface SmsProvider {
  /** messages.provider에 저장하고 웹훅 경로 /api/webhooks/sms/[provider]에 쓰는 이름 */
  readonly name: string;

  /**
   * 요청과 같은 수의 결과를 돌려준다. 묶음 전체가 실패해도 throw하지 않고 건별 retryable 결과로 바꾼다.
   * 일부만 접수된 묶음을 예외 하나로 뭉치면 접수된 건까지 다시 보내게 된다.
   */
  send(batch: readonly SendRequest[]): Promise<SendResult[]>;

  /** 검증을 통과한 요청만 넘긴다. 형식이 틀리면 throw하며, 원문은 호출하는 쪽이 이미 저장해 둔 상태다. */
  parseWebhook(request: WebhookRequest): WebhookEvent[];

  /** Web Crypto가 비동기라 Promise다. */
  verifySignature(request: WebhookRequest): Promise<boolean>;
}
