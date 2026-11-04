# Next.js 16.4와 Cache Components

2026-11-04 · 출처: 설치된 `next@16.4.5`의 `node_modules/next/dist/docs/` (`01-getting-started/08-caching.md`, `02-guides/authentication-with-cache-components.md`)

## 결정

`create-next-app` 기본값인 `cacheComponents: true`와 `partialPrefetching: true`를 유지한다.

## 이유

- 문서에 따르면 다음 메이저 버전에서 두 기능이 항상 켜지고 옵션이 사라진다. 끄고 시작하면 나중에 옮겨야 한다.
- 콘솔 화면 대부분은 사용자별 데이터지만, 사이드바와 상단 바 틀은 정적 셸로 먼저 보여 줄 수 있다.

## 지켜야 할 것 (1-4부터)

- `cookies()`를 읽는 코드는 `<Suspense>` 안에 둔다. 밖에 두면 빌드 오류가 난다.
- 레이아웃 최상단에서 세션을 `await`하지 않는다. 하위 화면 전체가 요청을 기다리게 된다.
- `use cache: private`로 사용자를 캐시하면 기본 5분 동안 재사용될 수 있다. 역할 전환 직후 이전 역할이 보이면 안 되므로, 권한 판단에 쓰는 조회와 전환 뒤 무효화를 구현할 때 함께 검증한다.
- 권한은 캐시된 값이나 화면 값을 믿지 않고 Server Action·Route Handler마다 다시 확인한다.
