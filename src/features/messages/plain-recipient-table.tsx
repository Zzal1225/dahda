"use client";

import { useEffect, useState } from "react";
import type { MessagePage, MessageRow } from "./message-query";

/**
 * 측정 1의 "변경 전" 버전. 일부러 모든 행을 받아 모두 그린다.
 * 다음 커밋에서 가상화 표로 교체하며, 이 커밋은 docs/performance.md의 재현 기준으로 남는다.
 */
const CHUNK = 1000;

export function PlainRecipientTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<MessageRow[]>();
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      performance.mark("table:fetch-start");
      const all: MessageRow[] = [];
      for (let offset = 0; ; offset += CHUNK) {
        const params = new URLSearchParams({
          campaignId,
          offset: String(offset),
          limit: String(CHUNK),
        });
        const response = await fetch(`/api/messages?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const page = (await response.json()) as MessagePage;
        if (cancelled) return;
        all.push(...page.rows);
        setLoaded(all.length);
        if (page.rows.length < CHUNK) break;
      }
      performance.mark("table:fetch-end");
      setRows(all);
    }

    loadAll().catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  useEffect(() => {
    if (!rows) return;
    // 커밋 직후 다음 프레임이 곧 사용자가 표를 보는 시점이다.
    requestAnimationFrame(() => {
      performance.mark("table:painted");
      document.documentElement.dataset.tableReady = String(rows.length);
    });
  }, [rows]);

  if (failed) return <p role="alert">메시지를 불러오지 못했어요</p>;
  if (!rows) return <p>메시지 불러오는 중 {loaded}건</p>;

  return (
    <table className="w-full text-body-sm">
      <thead>
        <tr>
          <th className="text-left">수신 번호</th>
          <th className="text-left">이름</th>
          <th className="text-left">상태</th>
          <th className="text-left">접수 시각</th>
          <th className="text-left">확정 시각</th>
          <th className="text-left">실패 코드</th>
          <th className="text-right">시도</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="h-(--row-dense) border-b border-border">
            <td className="text-mono">{row.phone}</td>
            <td>{row.recipientName}</td>
            <td>{row.status}</td>
            <td>{row.sentAt}</td>
            <td>{row.finalizedAt}</td>
            <td>{row.failCode}</td>
            <td className="text-right">{row.attemptCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
