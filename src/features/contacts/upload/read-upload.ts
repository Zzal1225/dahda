import type { TableInfo, WorkerRequest, WorkerResponse } from "./parse.worker";
import type { ColumnMap, UploadRow } from "./upload-rows";

// 정상 파일은 이보다 훨씬 빨리 끝난다. Worker가 멈춰도 화면이 영원히 "읽는 중"에 머물지 않게 한다.
const STEP_TIMEOUT_MS = 60_000;

export class UploadCanceledError extends Error {}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 파일 하나의 Worker 세션. 읽기와 분류 사이에 Worker를 살려 둬 읽은 표를 다시 보내지 않는다.
 * 동기 파싱은 중간에 멈출 수 없어, 취소는 Worker를 없애는 방식으로 한다. 끝나면 반드시 close()한다.
 */
export class UploadSession {
  private worker = new Worker(new URL("./parse.worker.ts", import.meta.url));
  private closed = false;

  /** 한 번에 한 단계만 돈다. 응답을 기다리는 동안 다음 요청을 보내지 않는다. */
  private run<T>(
    request: WorkerRequest,
    transfer: Transferable[],
    signal: AbortSignal,
    pick: (message: WorkerResponse) => Result<T> | null,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Result<T>> {
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", handleAbort);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        settle();
      };
      const handleAbort = () => {
        this.close();
        finish(() => reject(new UploadCanceledError()));
      };
      const timer = setTimeout(() => {
        this.close();
        finish(() =>
          resolve({
            ok: false,
            error:
              "파일을 처리하는 데 시간이 너무 오래 걸려요. 파일을 나눠서 올려 주세요",
          }),
        );
      }, STEP_TIMEOUT_MS);

      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort);

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") {
          onProgress?.(message.done, message.total);
          return;
        }
        if (message.type === "error") {
          finish(() => resolve({ ok: false, error: message.error }));
          return;
        }
        const picked = pick(message);
        if (picked) finish(() => resolve(picked));
      };
      this.worker.onerror = () => {
        this.close();
        finish(() =>
          resolve({
            ok: false,
            error: "파일을 읽지 못했어요. 엑셀 또는 CSV 파일인지 확인해 주세요",
          }),
        );
      };

      this.worker.postMessage(request, transfer);
    });
  }

  async read(file: File, signal: AbortSignal): Promise<Result<TableInfo>> {
    const buffer = await file.arrayBuffer();
    // 복사하지 않고 넘긴다. 5MB 파일을 복사하는 시간도 메인 스레드를 막는다.
    return this.run(
      { type: "read", buffer, fileName: file.name },
      [buffer],
      signal,
      (message) =>
        message.type === "table" ? { ok: true, value: message.info } : null,
    );
  }

  classify(
    map: ColumnMap,
    signal: AbortSignal,
    onProgress: (done: number, total: number) => void,
  ): Promise<Result<UploadRow[]>> {
    return this.run(
      { type: "classify", map },
      [],
      signal,
      (message) =>
        message.type === "rows" ? { ok: true, value: message.rows } : null,
      onProgress,
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
  }
}
