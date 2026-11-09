import { readSheet } from "./parse-file";
import {
  classifyTable,
  guessColumns,
  previewLines,
  type ColumnMap,
  type SheetTable,
  type UploadRow,
} from "./upload-rows";

/**
 * 업로드 전용 Worker. SheetJS의 파싱은 동기 작업이라 메인 스레드에서 돌면 끝날 때까지 화면 입력이 막힌다.
 * Worker에 두면 입력이 막히지 않고, 큰 라이브러리도 업로드를 열 때만 내려받는다.
 *
 * 두 단계다. read: 파일을 표로 읽어 머리글·첫 5줄·열 짐작을 돌려준다(사용자가 매핑을 확인한다).
 * classify: 고른 매핑으로 모든 줄을 분류하며 진행률을 보낸다.
 * 읽은 표는 Worker 안에 둔다. 2만 줄을 메인 스레드로 보냈다가 다시 받으면 복사만 두 번 늘어난다.
 */
export type WorkerRequest =
  | { type: "read"; buffer: ArrayBuffer; fileName: string }
  | { type: "classify"; map: ColumnMap };

export type TableInfo = {
  header: string[];
  preview: { rowNumber: number; cells: string[] }[];
  rowCount: number;
  guess: ColumnMap;
};

export type WorkerResponse =
  | { type: "table"; info: TableInfo }
  | { type: "progress"; done: number; total: number }
  | { type: "rows"; rows: UploadRow[] }
  | { type: "error"; error: string };

let table: SheetTable | null = null;

function send(message: WorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "read") {
    const result = readSheet(request.buffer, request.fileName);
    if (!result.ok) {
      send({ type: "error", error: result.error });
      return;
    }
    table = result.table;
    send({
      type: "table",
      info: {
        header: table.header,
        preview: previewLines(table),
        rowCount: table.lines.length,
        guess: guessColumns(table.header),
      },
    });
    return;
  }

  if (!table) {
    send({ type: "error", error: "파일을 먼저 읽어 주세요" });
    return;
  }
  const rows = classifyTable(table, request.map, (done, total) =>
    send({ type: "progress", done, total }),
  );
  send({ type: "rows", rows });
};
