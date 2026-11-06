// Explicit operator tool. Default is read-only; --apply installs the webhook.
export {};
// Secrets are read only from the process environment and never logged.
const token = process.env.TELEGRAM_MINI_APP_BOT_TOKEN;
const origin = process.env.APP_ORIGIN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const expectedBot = process.env.TELEGRAM_MINI_APP_BOT_USERNAME;
if (!token || !origin || !expectedBot)
  throw new Error("Set the RAJAB Mini App environment first");
const url = new URL(origin);
if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash)
  throw new Error("APP_ORIGIN must be an HTTPS origin");
async function call(method: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(`Telegram ${method} failed`);
  return data.result;
}
try {
  const me = await call("getMe");
  if (
    me.username?.toLowerCase() !== expectedBot.replace(/^@/, "").toLowerCase()
  )
    throw new Error("Token belongs to another bot; no changes made");
  const target = url.origin + "/api/telegram/webhook";
  const info = await call("getWebhookInfo");
  if (info.url && info.url !== target)
    throw new Error(
      "Bot already has another webhook; review it manually. No changes made",
    );
  console.log(
    "Correct bot verified; webhook:",
    info.url === target ? "matches" : "not installed",
  );
  console.log("Pending updates:", info.pending_update_count ?? 0);
  if (process.argv.includes("--apply")) {
    if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
      throw new Error("Set a 32–256 character webhook secret");
    await call("setWebhook", {
      url: target,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    const checked = await call("getWebhookInfo");
    if (checked.url !== target) throw new Error("Webhook verification failed");
    console.log(
      "RAJAB webhook installed and URL verified. Verify contact delivery in Telegram next.",
    );
  }
} catch (e) {
  // Fetch errors may include token-bearing URLs in their cause; never print them.
  console.error(
    e instanceof Error && !e.cause && !e.message.includes(token)
      ? e.message
      : "Telegram connection failed; no secret details logged",
  );
  process.exitCode = 1;
}
