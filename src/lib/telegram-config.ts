// Server configuration. Never expose the bot token in NEXT_PUBLIC variables.
export function telegramMiniAppEnabled() {
  return process.env.TELEGRAM_MINI_APP_ENABLED === "true";
}
export function telegramBotUsername() {
  const name = process.env.TELEGRAM_MINI_APP_BOT_USERNAME ?? "";
  return /^[A-Za-z0-9_]{5,32}$/.test(name) && /bot$/i.test(name) ? name : "";
}
