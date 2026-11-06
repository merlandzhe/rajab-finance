"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingBag, Store, ArrowRight, ShieldCheck } from "lucide-react";
import { telegramLogin } from "@/lib/telegram-login";
export function TelegramEntry({ bot }: { bot: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const started = useRef(false);
  async function enter() {
    if (!window.Telegram?.WebApp?.initData) {
      window.location.assign(`https://t.me/${bot}?startapp`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      router.push(await telegramLogin());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  // Preserve personal invitations; the server verifies their signed payload.
  useEffect(() => {
    const raw = window.Telegram?.WebApp?.initData;
    if (
      raw &&
      new URLSearchParams(raw).get("start_param")?.startsWith("invite_") &&
      !started.current
    ) {
      started.current = true;
      void enter();
    }
  }, []);
  return (
    <section className="card mini-entry">
      <span className="eyebrow entry-eyebrow">
        Покупать. Планировать. Управлять.
      </span>
      <h1>Рассрочка под контролем</h1>
      <p className="muted">Покупки, договоры и платежи — в HESAP.</p>
      <div className="role-options">
        <button
          className="role-card"
          disabled={busy}
          onClick={() => void enter()}
        >
          <span className="role-icon">
            <ShoppingBag size={24} aria-hidden="true" />
          </span>
          <span>
            <strong>Я покупатель</strong>
            <small>Мои заявки и платежи</small>
          </span>
          <ArrowRight size={18} />
        </button>
        <Link className="role-card" href="/mini/merchant">
          <span className="role-icon">
            <Store size={24} aria-hidden="true" />
          </span>
          <span>
            <strong>Я предприниматель</strong>
            <small>Клиенты и учёт рассрочки</small>
          </span>
          <ArrowRight size={18} />
        </Link>
      </div>
      {busy && (
        <p role="status" className="hint">
          Открываем кабинет…
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="entry-caption">
        <ShieldCheck size={15} aria-hidden="true" />
        Вход через Telegram · Без пароля
      </p>
    </section>
  );
}
