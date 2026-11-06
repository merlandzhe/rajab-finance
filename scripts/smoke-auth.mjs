// Isolated HTTP smoke test. Runs against a locally built Next.js server
// without Telegram/Supabase credentials and never touches live customer data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const port = 31079;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  APP_ORIGIN: origin,
  DEMO_MODE: "false",
  DEMO_DEPLOYMENT: "false",
  TELEGRAM_MINI_APP_ENABLED: "false",
  ALLOW_REAL_INTAKE: "false",
  // Fail closed even if the runner happens to carry project credentials.
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  TELEGRAM_MINI_APP_BOT_TOKEN: "",
  TELEGRAM_BOT_TOKEN: "",
  CRON_SECRET: "",
};
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", chunk => {
    logs = (logs + String(chunk)).slice(-3000);
  });
}
async function waitForServer() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Next.js exited before startup: " + logs);
    try {
      const response = await fetch(origin + "/api/state", {
        redirect: "manual",
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 401) return;
      throw new Error(`/api/state returned ${response.status}; expected 401`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("expected 401")) throw e;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Next.js did not start: " + logs);
}
const cases = [
  ["GET", "/api/state"],
  ["GET", "/api/platform/access"],
  ["GET", "/api/platform/customers"],
  ["POST", "/api/platform/merchants"],
  ["GET", "/api/telegram/health"],
  ["POST", "/api/telegram/dispatch"],
  ["POST", "/api/command"],
];
try {
  await waitForServer();
  for (const [method, path] of cases) {
    const response = await fetch(origin + path, {
      method,
      redirect: "manual",
      headers: {
        Origin: origin,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 401, `${method} ${path} must reject anonymous requests`);
    console.log(`PASS anonymous ${method} ${path} -> 401`);
  }
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null) {
    await Promise.race([
      once(server, "exit"),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
