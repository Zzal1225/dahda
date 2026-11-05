/**
 * 솔라피 웹훅을 API로 관리한다. 콘솔의 웹훅 수정 화면에 secret 칸이 없어, secret을 넣으려면 API 등록이 필요하다.
 * secret 없이 등록된 웹훅은 X-Solapi-Secret 헤더를 보내지 않아 우리 서버가 모두 거부한다.
 *
 * 사용: node --env-file=.env.solapi scripts/solapi-webhook.mjs <list|create|delete 웹훅ID>
 * .env.solapi(.env*로 gitignore됨): SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_WEBHOOK_SECRET
 *
 * SDK에 웹훅 API가 없어 fetch로 부른다. 웹훅 문서 예시는 Bearer지만 발송 SDK는 HMAC을 쓰므로 SDK 방식을 따랐다.
 * 응답을 그대로 출력하지 않는다. 응답에 secret이 들어 있어도 화면과 터미널 기록에 남지 않게 정해진 열만 보인다.
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SOLAPI_API_BASE ?? "https://api.solapi.com";
const WEBHOOK_URL = "https://dahda-xi.vercel.app/api/webhooks/sms/solapi";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name}이 비어 있습니다. .env.solapi를 확인하세요.`);
    process.exit(1);
  }
  return value;
}

function authorization() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", required("SOLAPI_API_SECRET"))
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${required("SOLAPI_API_KEY")}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authorization(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 오류 페이지처럼 JSON이 아닐 수 있다. 아래에서 상태 코드로 알린다.
  }
  if (!response.ok) {
    console.error(
      `실패 ${response.status} ${json?.errorCode ?? ""} ${json?.errorMessage ?? ""}`,
    );
    process.exit(1);
  }
  return json;
}

/** 문서에 목록 응답 형식이 없다. 구조를 가정하지 않고 webhookId가 있는 객체를 찾는다. */
function findWebhooks(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => findWebhooks(item, found));
  else if (value && typeof value === "object") {
    if ("webhookId" in value) found.push(value);
    else Object.values(value).forEach((item) => findWebhooks(item, found));
  }
  return found;
}

function print(webhook) {
  const secret = !("secret" in webhook)
    ? "응답에 없음"
    : webhook.secret
      ? "있음"
      : "비어 있음";
  console.log(
    `${webhook.webhookId} | ${webhook.eventId} | ${webhook.status} | ${webhook.url} | secret: ${secret}`,
  );
}

const [command, argument] = process.argv.slice(2);

if (command === "list") {
  const webhooks = findWebhooks(await call("GET", "/webhook/v1/outgoing"));
  if (webhooks.length === 0) console.log("등록된 웹훅이 없습니다.");
  webhooks.forEach(print);
} else if (command === "create") {
  const created = await call("POST", "/webhook/v1/outgoing", {
    eventId: "SINGLE-REPORT",
    url: WEBHOOK_URL,
    secret: required("SOLAPI_WEBHOOK_SECRET"),
  });
  console.log("등록했습니다.");
  findWebhooks(created).forEach(print);
} else if (command === "delete" && argument) {
  await call("DELETE", `/webhook/v1/outgoing/${encodeURIComponent(argument)}`);
  console.log(`삭제했습니다: ${argument}`);
} else {
  console.error("사용: list | create | delete 웹훅ID");
  process.exit(1);
}
