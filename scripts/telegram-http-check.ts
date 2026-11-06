// Build with TELEGRAM_MINI_APP_ENABLED=true DEMO_MODE=false first.
// Uses only synthetic credentials and a temporary local server; no live DB/bot.
import assert from "node:assert/strict";
import next from "next";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
Object.assign(process.env, {
  DEMO_MODE: "false",
  DEMO_DEPLOYMENT: "false",
  TELEGRAM_MINI_APP_ENABLED: "true",
  TELEGRAM_MINI_APP_BOT_TOKEN: "123456789:synthetic-test-token",
  TELEGRAM_MINI_APP_BOT_USERNAME: "rajab_test_only_bot",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
});
const app = next({ dev: false, dir: process.cwd() });
await app.prepare();
const server = createServer(app.getRequestHandler());
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.APP_ORIGIN = origin;
try {
  let checks = 0;
  function check(label: string, value: boolean) {
    assert.ok(value, label);
    console.log("PASS", label);
    checks++;
  }
  const page = await fetch(origin + "/mini");
  check("enabled Mini App page renders", page.ok);
  const html = await page.text();
  check(
    "official Telegram SDK and entry component render",
    html.includes("https://telegram.org/js/telegram-web-app.js") &&
      html.includes("Личный кабинет в Telegram"),
  );
  const csp = page.headers.get("content-security-policy") ?? "";
  check(
    "CSP only allows Telegram Web as frame parent",
    csp.includes("frame-ancestors https://web.telegram.org;") &&
      !page.headers.has("x-frame-options"),
  );
  check(
    "invitation URLs cannot leak through Referer",
    page.headers.get("referrer-policy") === "no-referrer",
  );
  async function post(path: string, body: unknown, source = origin) {
    return fetch(origin + path, {
      method: "POST",
      headers: { Origin: source, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  check(
    "unsigned Telegram identity denied",
    (
      await post("/api/auth/telegram", {
        initData:
          "user=%7B%22id%22%3A123%7D&auth_date=1800000000&hash=" +
          "0".repeat(64),
      })
    ).status === 401,
  );
  check(
    "client cannot provide role or tenant",
    (
      await post("/api/auth/telegram", {
        initData: "forged",
        role: "owner",
        tenant_id: "forged",
      })
    ).status === 400,
  );
  check(
    "foreign origin denied",
    (
      await post(
        "/api/auth/telegram",
        { initData: "forged" },
        "https://attacker.invalid",
      )
    ).status === 403,
  );
  check(
    "anonymous invitation issuance denied",
    (await post("/api/telegram/invite", {})).status === 401,
  );
  check(
    "anonymous CRM state denied",
    (await fetch(origin + "/api/state")).status === 401,
  );
  console.log(`TELEGRAM HTTP CHECKS PASSED: ${checks}`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
}
