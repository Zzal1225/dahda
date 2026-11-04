import { parseFile } from "./parse-file";
import type { ParseResult } from "./upload-rows";

/**
 * 파일 파싱 전용 Worker. SheetJS의 파싱은 동기 작업이라 메인 스레드에서 돌면 끝날 때까지 화면 입력이 막힌다.
 * Worker에 두면 입력이 막히지 않고, 큰 라이브러리도 업로드 화면을 쓸 때만 내려받는다.
 */
export type ParseRequest = { buffer: ArrayBuffer; fileName: string };

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const result: ParseResult = parseFile(event.data.buffer, event.data.fileName);
  self.postMessage(result);
};
