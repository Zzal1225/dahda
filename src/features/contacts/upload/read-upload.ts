import { parseFile } from "./parse-file";
import type { ParseResult } from "./upload-rows";

/**
 * 측정 2의 "변경 전" 버전. 일부러 메인 스레드에서 파싱한다.
 * 다음 커밋에서 Web Worker로 바꾸며, 이 커밋이 docs/performance.md의 재현 기준으로 남는다.
 */
export async function readUpload(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  return parseFile(buffer, file.name);
}
