# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 따르는 규칙이다.
이 프로젝트는 **두 번째 포트폴리오**다. nanaki(첫 프로젝트)와 같은 방식으로 Claude가 구현하고 사용자는 "왜" 주석과
`private/learning/`으로 공부하되, **핵심 파일 3개는 사용자가 직접 짠다**(5-1 참고). 상세 기획은 `docs/기획서.md`를 따른다.

---

## 1. 목적

- **무엇을**: dahda("닿다") 마트·소상공인용 B2B 문자 발송 관리자 콘솔. 본사 → 지점 2단계 조직, 역할 2개(본사·지점, 지점 = 담당자 1명),
  주소록 엑셀 업로드, 광고 문자 본사 승인, 지점별 충전금, DB 큐 발송, 결과 웹훅 실시간 반영, 10만 행 발송 내역, 토스 충전금.
- **왜**: 문자는 보낸 순간이 아니라 도착이 확인된 순간에 끝난다. 접수와 도착이 다른 비동기 결과를 화면에 정확히 보여 주는 콘솔.
- **포트폴리오로 증명할 것 (nanaki와 겹치지 않는 축)**: 외부 API 3종(문자 발송·결과 웹훅·결제)을 실패·지연·중복까지 다룸,
  B2B 화면(10만 행 가상화·URL 필터·대량 업로드·검증 많은 폼·역할 권한), 큐·재시도·멱등성·상태 전이, 도메인 지식(광고 문자 규칙).
- **핵심 원칙**: 상태는 화살표 방향으로만 바뀐다(역행 금지). 돈은 잔액 숫자가 아니라 계정(지점·본사)별 거래 기록 합계. 권한은 화면과 RLS 양쪽.
  외부 API는 서버만 부른다. 전 회사 화면·코드·문구를 쓰지 않는다.
- **범위**: 1차(step1~5, 전체 약 5주 목표)는 기획서 "기능 범위" 표. 미구현 기능은 숨긴다("준비 중" 버튼 없음). 2차 기능은 1차 완료 전에 시작하지 않는다.
- **화면**: PC 1280px 이상 우선, 태블릿은 접힌 사이드바, 모바일은 승인함만. 라이트 모드만(다크 모드는 범위 밖, 토큰은 라이트 값만). 한국어·원화.
- **계정**: 이메일 로그인 + 체험하기(익명 로그인 + 샘플 본사, 역할 전환 버튼, 3일 뒤 삭제). 체험 계정은 가짜 발송기 고정.

## 2. 기술 스택

| 영역 | 선택 |
| --- | --- |
| 프레임워크 | Next.js (App Router) + TypeScript (strict) |
| 백엔드 | Supabase (Postgres + RLS, Auth, Edge Function, pg_cron, Realtime). 세션 쿠키는 `@supabase/ssr` |
| 서버 상태 | TanStack Query (캐시 키는 `['campaigns', branchId, filters]` 형태로 features 안에서 정의) |
| 화면 상태 | Zustand (역할 전환·선택 행 등 화면 상태만. 서버 데이터 금지) |
| URL 상태 | nuqs (표 필터·정렬·페이지) |
| 표 | TanStack Table + TanStack Virtual |
| 폼·검증 | React Hook Form + Zod |
| 엑셀 | SheetJS(xlsx) + Web Worker (직접 작성, 라이브러리 없음) |
| 스타일·컴포넌트 | Tailwind + shadcn/ui + lucide-react. 디자인 토큰 원본은 핸드오프 `0 디자인 시스템.dc.html` (`tokens.test.ts`가 일치 검사) |
| 문자 | 솔라피 SDK (어댑터 안에서만) + 가짜 발송기 |
| 결제 | 토스페이먼츠 결제위젯 + 서버 승인 API (테스트 키만) |
| 테스트 | Vitest, Testing Library, MSW, Playwright (E2E + 1280/1440 화면 비교) |
| CI/CD | GitHub Actions, Lighthouse CI(발송 내역 1개), Vercel, Supabase CLI 마이그레이션 |

- 위 목록에 없는 라이브러리는 먼저 **이유와 대안**을 제시하고 승인을 받는다.
- 외부 서비스 SDK·비밀 키는 `server/providers/` 밖에서 import하지 않는다. 브라우저에서 외부 API를 직접 부르지 않는다.
- `SmsProvider` 인터페이스(`send`, `parseWebhook`, `verifySignature`) 하나에 `SolapiProvider`, `FakeProvider` 두 구현. 선택은 환경 변수.
- 실제 발송 안전장치: 허용 수신번호 목록과 하루 상한(환경 변수)을 어댑터 앞단에서 코드로 막는다. CI·체험·테스트는 항상 가짜 발송기.
- 결제 금액은 브라우저 값을 믿지 않고 승인 전에 DB `payments.amount`와 대조한다. 승인과 거래 기록은 한 트랜잭션.
- Next.js는 16.4(Cache Components 사용). 코드를 쓰기 전 `node_modules/next/dist/docs/`의 해당 문서를 확인한다.
- 잔액 계정은 지점마다 하나 + 본사 하나(`ledger_entries.branch_id`, null = 본사). 잔액 검사 + `reserve` 기록은 계정 id를 받는 Postgres 함수 한 트랜잭션에서. 모든 거래 기록에 멱등 키.
- 상태 전이는 `features/campaigns/status.ts`의 순수 함수 하나로만 바꾼다(큐 워커·웹훅 모두 이 함수 사용). 최종 상태는 덮어쓰지 않는다.
- 웹훅 Route Handler 순서: 서명 검증 → `webhook_events` 원문 저장 → 상태 전이 → 집계 갱신. 실패해도 원문은 남긴다.
- 전화번호는 정규화된 숫자만 저장. 화면에서 가리지 않는다(모든 역할이 전체 번호를 봄). 엑셀 내보내기는 본사만.
- 실패 건 재발송은 원본 행을 바꾸지 않고 새 발송 건을 만들어 `retry_of_campaign_id`로 잇는다.
- 충전은 계정 주인만 한다. 본사는 지점 잔액을 조회만 한다.
- 법·업체 규칙(바이트 기준, (광고) 표기, 야간 제한 시간대, 전송 제한)은 추측하지 않는다. 공식 문서 확인 후 출처와 함께 `docs/decisions/`에 기록하고,
  확인 못 한 값은 코드에 `// 확인 필요:` 주석과 설정값으로 둔다.

## 3. 코드맵

> 실제 구조가 생기면 채운다. `(예정)`은 아직 없는 폴더.

```
src/
  app/                 라우트. (app)/ = 로그인 뒤 화면, api/webhooks/sms/[provider], api/payments/confirm
  features/
    auth/              로그인·체험·역할 전환
    org/               본사·지점·구성원
    contacts/          주소록·그룹·수신거부·엑셀 업로드(worker/)
    campaigns/         발송 건 작성·승인·내역, status.ts(상태 전이), campaignSchema.ts(사용자 작성)
    messages/          수신자별 메시지 표(10만 행), useTableState.ts(사용자 작성)
    billing/           충전·거래 기록·토스 연동 화면
  server/
    providers/         SmsProvider 인터페이스, solapi/, fake/
    queue/             워커 로직(Edge Function에서 호출), 재시도 규칙
    auth/              requireRole.ts(사용자 작성), RLS 보조
  server/supabase/     요청 사용자 클라이언트(server.ts), RLS를 건너뛰는 클라이언트(admin.ts)
  server/db/           database.types.ts (supabase gen types 생성, 손으로 고치지 않음)
  test/integration/    RLS·제약·잔액 통합 테스트 (npm run test:integration, 로컬 Supabase 필요)
  components/shell/    사이드바·상단 바·역할 전환, nav-items.ts(메뉴와 역할)
  components/ui/       shadcn/ui 복사본 + 토큰
  proxy.ts             토큰 갱신, 세션 없는 요청 이동만 (권한 판단 금지)
e2e/                   Playwright (npm run test:e2e, 로컬 Supabase 필요)
supabase/
  migrations/          테이블·RLS·함수(잔액 선점)·pg_cron. 상태·돈 테이블 쓰기는 service_role만 (사용자는 읽기만)
  functions/           Edge Function (send-worker)
  seed/                10만 행 시드 (npm run db:seed:large, db reset 후 다시 실행). 체험 샘플은 create_trial_org
docs/                  기획서.md, performance.md, decisions/, troubleshooting/, assets/
design/                디자인 핸드오프 원본 (gitignore, 로컬 전용)
private/               learning/, interview-questions.md, decisions 초안 (gitignore)
```

## 4. 규칙

### 네이밍
- 파일·폴더 kebab-case, 컴포넌트 PascalCase, 훅 `use*`, 서버 함수 동사형(`reserveBalance`).
- DB 열 snake_case, TS 타입 camelCase. 변환은 `server/` 경계에서 한 번만.
- 상태 값은 기획서의 영문 그대로(`queued`, `sent`, `delivered`, `failed`).

### 컴포넌트 작성
- 표는 공통 `DataTable` 하나. 화면마다 열 정의와 `useTableState`만 다르다.
- 폼은 Zod 스키마 → RHF. 검증 메시지는 스키마에만 둔다.
- 되돌리기 어려운 동작(삭제·반려·재발송·발송)은 확인 대화상자.
- 빈 상태·로딩·오류 상태를 모든 목록에 둔다.

### 권한
- 서버 컴포넌트·Route Handler·화면 모두 `requireRole`을 거친다. RLS가 최종 경계이고 화면은 편의다.
- 체험 계정의 역할 전환은 서버가 `members.role`을 바꾼다(화면만 바꾸는 가짜 전환 금지).

### 코드 스타일
- ESLint + Prettier, `strict`, `noUncheckedIndexedAccess`. `any` 금지.
- 날짜는 서버 UTC 저장, 화면은 KST 표시. 예약 시각 입력은 KST로 받고 변환 지점을 한 곳에 둔다.

## 5. 워크플로우

### 5-1. 구현 방식 (기본값, 가장 중요)
Claude가 기능을 직접 구현한다. 단, 아래 3개 파일은 **사용자가 직접 작성**한다. Claude는 설계 설명, 입력·출력 정의, 힌트, 코드 리뷰, 테스트 작성만 한다.
사용자가 요청하지 않는 한 이 파일의 본문을 써 주지 않는다.
1. `features/messages/useTableState.ts` — 필터·정렬·페이지·선택과 URL 동기화
2. `features/campaigns/campaignSchema.ts` — 발송 폼 Zod 스키마(바이트·광고 규칙·예약 시각)
3. `server/auth/requireRole.ts` — 권한 가드

나머지 절차는 nanaki와 같다.
1. **시작 전 합의**: 입력·출력·파일 위치를 3~5줄로 정리하고, 사용자가 정해야 하는 결정만 추천안과 함께 묻는다.
2. **구현**: 한 번에 한 기능. 로직은 테스트를 먼저 또는 함께.
3. **주석**: 모든 파일에 "왜" 주석(설계 이유, 버린 대안, 함정). 코드를 다시 말하는 주석 금지.
4. **학습 노트**: `private/learning/00-roadmap.md` + 기능마다 `NN-기능명.md`(무엇을·왜, 데이터 흐름, 핵심 개념, 함정, 면접 질문, 직접 해 볼 것).
5. **마무리 응답**: 만든 것, 확인한 것(테스트·빌드), 확인 못 한 것, 학습 노트 파일.

### 5-2. 작업 절차
1. 관련 파일·이 문서·기획서 범위 확인. 범위 밖이면 먼저 알린다.
2. 구현 → 3. 테스트(상태 전이·금액·바이트·광고 규칙·전화번호 정규화·재시도 계산은 단위 테스트 필수) → 4. `lint`, `typecheck`, `test` 통과 후 커밋.
5. 성능 작업은 **변경 전 수치를 먼저 측정**하고 전후를 `docs/performance.md`에 측정 조건과 함께 기록.
6. 외부 API 작업은 공식 문서 확인 결과(출처·날짜)를 `docs/decisions/YYYY-MM-DD-제목.md`에 남긴다.

### 5-3. 포트폴리오 기록
- 트러블슈팅: 30분 이상 막혔거나 원인이 예상과 달랐으면 `private/troubleshooting/`에 문제 → 원인 → 해결 → 결과. 막바지에 골라 `docs/troubleshooting/`으로.
- 측정 5개(기획서 "측정 수치"): 전/후 수치, 측정 조건, 스크립트 경로를 `docs/performance.md`에.
- 전후 캡처는 `docs/assets/기능명-before.png`, `-after.png`.
- step이 끝나면 테스트 개수·CI·Lighthouse를 `docs/milestones.md`에 한 번 정리.

### 5-4. 면접 예상 질문
- 작업 중 나온 설계 결정·트레이드오프·트러블슈팅은 `private/interview-questions.md`에 `## YYYY-MM-DD 작업명` / `Q:` / `답 핵심:` / `근거:` 형식으로 추가.
- 기획서 "면접 예상 질문" 목록의 답을 실제로 한 것 기준으로 채운다. 답은 초안이고 사용자가 자기 말로 고친다.
- `private/`는 gitignore. 커밋·PR·README에 넣지 않는다.

## 6. 모듈별 규칙

> 모듈이 구체화된 후 작성한다.

<!-- 예상 모듈: auth, org, contacts(upload worker), campaigns(status, approval), messages(table), billing(toss, ledger),
     providers(solapi, fake), queue(worker, retry), webhooks -->
