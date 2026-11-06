"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, KeyRound, MessageCircle, Store } from "lucide-react";
import { Brand } from "./brand";
import { telegramLogin } from "@/lib/telegram-login";
const statuses: Record<string, string> = {
  new: "Заявка отправлена",
  review: "Заявка на рассмотрении",
  approved: "Доступ согласован — получите код у владельца HESAP",
  rejected: "Свяжитесь с владельцем HESAP по вашей заявке",
  activated: "Кабинет подключён",
};
export function MerchantEntry({ bot }: { bot: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"intro" | "request" | "code">("intro"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  async function choose(next: "request" | "code" | "login") {
    setError("");
    setBusy(true);
    try {
      const path = await telegramLogin();
      if (path.startsWith("/crm")) {
        router.push(path);
        router.refresh();
        return;
      }
      if (next === "login") {
        setError(
          "К этому Telegram ещё не подключён магазин. Подайте заявку или введите код.",
        );
        return;
      }
      if (next === "request") {
        const r = await fetch("/api/merchant-request");
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setStatus(d ? (statuses[d.status] ?? d.status) : "");
      }
      setMode(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mini-page">
      <Brand />
      <section className="card mini-entry merchant-access">
        {mode === "intro" ? (
          <Link className="back-link" href="/mini">
            ← Выбор роли
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="back-link merchant-back"
            onClick={() => {
              setMode("intro");
              setError("");
            }}
          >
            ← Кабинет магазина
          </button>
        )}
        <h1>
          {mode === "intro"
            ? "Кабинет магазина"
            : mode === "code"
              ? "Введите код доступа"
              : status
                ? "Статус подключения"
                : "Подключить магазин"}
        </h1>
        {mode === "intro" && (
          <div className="merchant-start">
            <button
              disabled={busy}
              className="btn btn-primary full"
              onClick={() => void choose("login")}
            >
              Войти в мой кабинет
            </button>
            <div className="merchant-options">
              <button disabled={busy} onClick={() => void choose("request")}>
                <Store size={20} />
                <span>
                  Подключить магазин<small>Заявка на доступ</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button disabled={busy} onClick={() => void choose("code")}>
                <KeyRound size={20} />
                <span>У меня есть код</span>
                <ChevronRight size={16} />
              </button>
            </div>
            {busy && <p role="status">Проверяем доступ…</p>}
          </div>
        )}
        {mode === "request" && !status && (
          <form
            className="merchant-entry-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/merchant-request", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: f.get("name"),
                    shop_name: f.get("shop"),
                    city: f.get("city"),
                    phone: String(f.get("phone")).replace(/[\s()-]/g, ""),
                  }),
                });
                const d = await r.json();
                if (!r.ok) throw Error(d.error);
                setStatus(
                  "Заявка отправлена. Владелец HESAP свяжется с вами в Telegram.",
                );
                window.Telegram?.WebApp?.requestWriteAccess?.();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset>
              <legend>Магазин</legend>
              <label className="field">
                Название магазина
                <input name="shop" minLength={2} maxLength={120} required />
              </label>
              <label className="field">
                Город
                <input
                  name="city"
                  autoComplete="address-level2"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Контакт для связи</legend>
              <label className="field">
                Имя
                <input
                  name="name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
              <label className="field">
                Контактный телефон
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+7 999 123-45-67"
                  maxLength={25}
                  required
                />
              </label>
            </fieldset>
            <p className="muted">
              Контакт нужен владельцу HESAP для обсуждения подключения.{" "}
              <Link href="/privacy">Обработка данных</Link>
            </p>
            <button disabled={busy} className="btn btn-primary full">
              {busy ? "Отправляем…" : "Отправить заявку"}
            </button>
          </form>
        )}
        {status && mode === "request" && (
          <div className="card pad mt">
            <p role="status">{status}</p>
            <button
              className="btn btn-primary full mt"
              onClick={() => setMode("code")}
            >
              У меня есть код
            </button>
          </div>
        )}
        {mode === "code" && (
          <form
            className="merchant-entry-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const raw = String(
                new FormData(e.currentTarget).get("code"),
              ).trim();
              try {
                const r = await fetch("/api/merchant-activate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ code: raw }),
                });
                const d = await r.json();
                if (!r.ok) throw Error(d.error);
                router.push("/crm");
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Одноразовый код
              <textarea
                name="code"
                rows={2}
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Код от владельца HESAP"
              />
            </label>
            <p className="muted">
              Код действует 24 часа и привязан к Telegram, с которого отправлена
              заявка.
            </p>
            <button disabled={busy} className="btn btn-primary full">
              {busy ? "Подключаем…" : "Активировать кабинет"}
            </button>
          </form>
        )}
        {error && (
          <p className="error mt" role="alert">
            {error}
          </p>
        )}
        <details className="merchant-help">
          <summary>
            <MessageCircle size={16} /> Помощь с подключением
          </summary>
          <a href="https://t.me/merlandzhe" target="_blank" rel="noreferrer">
            Написать владельцу HESAP
          </a>
          {bot && (
            <a href={`https://t.me/${bot}?start=hesap`}>
              Подключить уведомления в Telegram
            </a>
          )}
        </details>
      </section>
    </main>
  );
}
