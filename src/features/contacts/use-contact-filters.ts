"use client";

import {
  createParser,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useCallback, useTransition } from "react";
import { RECEIVE_STATUSES, type ReceiveStatus } from "./receive-status";

const pageParser = createParser<number>({
  parse: (value) => (/^[1-9][0-9]*$/.test(value) ? Number(value) : null),
  serialize: String,
});

// 키 이름이 곧 공유 링크의 형식이다. 서버(page.tsx)가 contactFiltersSchema로 한 번 더 검사한다.
const parsers = {
  q: parseAsString.withDefault(""),
  group: parseAsString,
  branch: parseAsString,
  status: parseAsStringLiteral(RECEIVE_STATUSES),
  page: pageParser.withDefault(1),
};

export type ContactFilterPatch = Partial<{
  q: string;
  group: string | null;
  branch: string | null;
  status: ReceiveStatus | null;
}>;

/**
 * 주소록의 URL 상태(nuqs). 표 데이터는 서버 컴포넌트가 읽으므로 shallow: false로 서버를 다시 그리게 한다.
 * 필터가 바뀌면 page를 지운다. 뒤쪽 페이지에서 결과가 줄면 빈 페이지가 보인다.
 * history: replace — 검색어 한 글자마다 뒤로 가기 기록이 쌓이지 않게 한다.
 */
export function useContactFilters() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useQueryStates(parsers, {
    shallow: false,
    history: "replace",
    scroll: false,
    startTransition,
  });

  const setFilters = useCallback(
    (patch: ContactFilterPatch) => {
      void setState({ ...patch, page: null });
    },
    [setState],
  );
  const setPage = useCallback(
    (page: number) => {
      void setState({ page: page <= 1 ? null : page });
    },
    [setState],
  );

  return { state, pending, setFilters, setPage };
}
