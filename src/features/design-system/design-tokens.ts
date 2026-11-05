/**
 * 화면에 보여 줄 토큰 이름. 값은 적지 않는다. globals.css가 원본이고 화면은 CSS 변수로 그린다.
 * 값을 여기 또 적으면 원본이 둘이 되어 페이지가 실제와 다른 색을 보여 줄 수 있다.
 * 새 색을 추가하고 여기에 빠뜨리면 design-tokens.test.ts가 잡는다.
 */
export const COLOR_GROUPS = [
  {
    title: "바탕과 테두리",
    tokens: [
      "--bg",
      "--surface",
      "--surface-2",
      "--surface-3",
      "--border",
      "--border-strong",
      "--skeleton",
      "--overlay",
    ],
  },
  {
    title: "글자",
    tokens: ["--text", "--text-muted", "--text-disabled"],
  },
  {
    title: "브랜드",
    tokens: [
      "--primary",
      "--primary-hover",
      "--primary-pressed",
      "--primary-fg",
      "--primary-subtle",
      "--focus",
    ],
  },
  {
    title: "위험",
    tokens: [
      "--danger",
      "--danger-hover",
      "--danger-pressed",
      "--danger-fg",
      "--danger-subtle",
    ],
  },
  {
    title: "상태",
    tokens: [
      "--st-idle",
      "--st-sent",
      "--st-delivered",
      "--st-failed",
      "--st-pending",
      "--st-approved",
      "--st-rejected",
    ],
  },
] as const;

export const TYPE_SCALE = [
  { className: "text-display", name: "display", usage: "큰 제목" },
  { className: "text-title-lg", name: "title-lg", usage: "화면 제목" },
  { className: "text-title", name: "title", usage: "구역 제목" },
  { className: "text-number-lg", name: "number-lg", usage: "숫자 카드" },
  { className: "text-body", name: "body", usage: "본문" },
  { className: "text-body-sm", name: "body-sm", usage: "표와 폼" },
  { className: "text-caption", name: "caption", usage: "보조 설명" },
] as const;

export const SIZE_TOKENS = [
  ["--control-h", "버튼과 입력 높이"],
  ["--control-h-touch", "터치 화면 높이"],
  ["--row-dense", "표 머리글"],
  ["--row-default", "표 행"],
  ["--sidebar-w", "사이드바"],
  ["--sidebar-w-collapsed", "접힌 사이드바"],
  ["--topbar-h", "상단 바"],
  ["--content-max", "본문 최대 폭"],
] as const;
