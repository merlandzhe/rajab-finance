// Use only configured server credentials. Never return Telegram errors or URLs
// containing the bot token to the browser.
export async function configureTelegram(apply = false) {
  const token = process.env.TELEGRAM_MINI_APP_BOT_TOKEN;
  const origin = process.env.APP_ORIGIN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const expected = process.env.TELEGRAM_MINI_APP_BOT_USERNAME;
  if (!token || !origin || !expected || !secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash)
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  const target = base.origin + "/api/telegram/webhook";
  async function call(method: string, body: Record<string, unknown> = {}) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error();
      return data.result;
    } catch { throw new Error("TELEGRAM_NOT_CONFIGURED"); }
  }
  const me = await call("getMe");
  if (me.username?.toLowerCase() !== expected.replace(/^@/, "").toLowerCase())
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  let info = await call("getWebhookInfo");
  if (info.url && info.url !== target) throw new Error("TELEGRAM_WEBHOOK_CONFLICT");
  if (apply) {
    await call("setWebhook", { url: target, secret_token: secret,
      allowed_updates: ["message"], drop_pending_updates: false });
    info = await call("getWebhookInfo");
    if (info.url !== target) throw new Error("TELEGRAM_NOT_CONFIGURED");
  }
  return { connected: info.url === target, pending: info.pending_update_count ?? 0,
    deliveryIssue: Boolean(info.last_error_message) };
}
