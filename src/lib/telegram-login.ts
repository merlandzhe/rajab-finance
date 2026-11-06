"use client";
export async function telegramLogin() {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw Error("Откройте HESAP через Telegram-бота.");
  const r = await fetch("/api/auth/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  if (!["/cabinet", "/cabinet/setup", "/crm", "/crm/platform"].includes(d.path))
    throw Error("Не удалось открыть кабинет");
  return d.path as string;
}
