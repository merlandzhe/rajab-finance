"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
export function PlatformTelegram() {
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/platform/telegram", { cache: "no-store", signal: controller.signal })
      .then(async r => { if (r.ok) { const d = await r.json(); setConnected(d.connected); } })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (connected) return <section className="card pad mb"><div className="row"><CheckCircle2 size={20} className="gold" /><strong>Telegram подключён</strong></div><p className="muted mt">Подтверждение телефона и канал уведомлений настроены.</p></section>;
  return <section className="card pad mb">
    <h2>Регистрация и уведомления</h2>
    <p className="muted mt">Подключите Telegram для подтверждения телефонов и уведомлений.</p>
    <button className="btn btn-primary mt" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        const r = await fetch("/api/platform/telegram", { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setConnected(d.connected);
      } catch (e) { setMessage(e instanceof Error ? e.message : "Не удалось подключить Telegram"); }
      finally { setBusy(false); }
    }}>{busy ? "Подключаем…" : "Подключить Telegram"}</button>
    {message && <p className="hint mt" role="status">{message}</p>}
  </section>;
}
