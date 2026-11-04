import type { ParseRequest } from "./parse.worker";
import type { ParseResult } from "./upload-rows";

// 정상 파일은 이보다 훨씬 빨리 끝난다. Worker가 멈춰도 화면이 영원히 "읽는 중"에 머물지 않게 한다.
const PARSE_TIMEOUT_MS = 60_000;

export class UploadCanceledError extends Error {}

/**
 * 파일을 Worker에서 읽는다. 파일마다 새로 만들고 끝나면 종료한다.
 * 동기 파싱은 중간에 멈출 수 없어, 취소는 Worker를 없애는 방식으로 한다.
 */
export async function readUpload(
  file: File,
  signal: AbortSignal,
): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();

  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(new URL("./parse.worker.ts", import.meta.url));

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      worker.terminate();
      settle();
    };
    const handleAbort = () => finish(() => reject(new UploadCanceledError()));
    const timer = setTimeout(() => {
      finish(() =>
        resolve({
          ok: false,
          error:
            "파일을 읽는 데 시간이 너무 오래 걸려요. 파일을 나눠서 올려 주세요",
        }),
      );
    }, PARSE_TIMEOUT_MS);

    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener("abort", handleAbort);

    worker.onmessage = (event: MessageEvent<ParseResult>) => {
      finish(() => resolve(event.data));
    };
    worker.onerror = () => {
      finish(() =>
        resolve({
          ok: false,
          error: "파일을 읽지 못했어요. 엑셀 또는 CSV 파일인지 확인해 주세요",
        }),
      );
    };

    const request: ParseRequest = { buffer, fileName: file.name };
    // 복사하지 않고 넘긴다. 5MB 파일을 복사하는 시간도 메인 스레드를 막는다.
    worker.postMessage(request, [buffer]);
  });
}
