"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, ExternalLink, Send, LoaderCircle } from "lucide-react";

type Preference = { enabled: boolean; linked: boolean; bot_started: boolean };

export function MerchantTelegramSwitch() {
  const pathname = usePathname();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [pref, setPref] = useState<Preference | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [allowed, setAllowed] = useState(true);
  const isOverview = pathname === "/crm";

  useEffect(() => {
    if (!isOverview) {
      setMount(null);
      return;
    }
    let target: HTMLElement | null = null;
    const findTarget = () => {
      if (target?.isConnected) return;
      const area =
        document.querySelector<HTMLElement>(".merchant-upgrade") ??
        document.querySelector<HTMLElement>(".merchant-app main") ??
        document.querySelector<HTMLElement>("main");
      if (!area) return;
      target = document.createElement("div");
      target.className = "mtg-portal-slot";
      // Keep the toggle close to existing business action cards.
      const shortcut = area.querySelector(".pc-shortcut-mount");
      if (shortcut?.nextSibling) {
        area.insertBefore(target, shortcut.nextSibling);
      } else if (shortcut) {
        area.appendChild(target);
      } else {
        area.prepend(target);
      }
      setMount(target);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      target?.remove();
      setMount(null);
    };
  }, [isOverview]);

  useEffect(() => {
    if (!isOverview) {
      setPref(null);
      setMessage("");
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/telegram/merchant-preference", {
          credentials: "same-origin", cache: "no-store",
        });
        if (response.status === 401 || response.status === 403) {
          if (active) setAllowed(false);
          return;
        }
        if (!response.ok) throw Error("Не удалось загрузить настройку");
        const data = (await response.json()) as Preference;
        if (active) { setPref(data); setAllowed(true); setMessage(""); }
      } catch {
        if (active) setMessage("Не удалось проверить уведомления. Обновите страницу.");
      }
    };
    void load();
    const focused = () => void load();
    window.addEventListener("focus", focused);
    return () => { active = false; window.removeEventListener("focus", focused); };
  }, [isOverview]);

  async function change() {
    if (!pref || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/telegram/merchant-preference", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !pref.enabled }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.enabled !== "boolean")
        throw Error(data.error || "Не удалось сохранить переключатель");
      setPref(data as Preference);
      setMessage(data.enabled ? "Уведомления включены" : "Уведомления отключены");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройку");
    } finally {
      setBusy(false);
    }
  }

  if (!isOverview || !mount || !allowed) return null;

  return createPortal(
    <section className="mtg-card" aria-label="Настройки уведомлений Telegram">
      <span className="mtg-telegram-icon"><Send size={23} fill="currentColor" strokeWidth={1.75}/></span>
      <div className="mtg-text">
        <strong>Уведомления в Telegram</strong>
        <small>
          {!pref ? "Проверяем подключение…" :
           !pref.enabled ? "Отключены для вашего аккаунта" :
           !pref.linked ? "Включены · нужно привязать бота" :
           !pref.bot_started ? "Включены · запустите бота" :
           "Включены для вашего аккаунта"}
        </small>
        {message && <span className="mtg-feedback" role="status">{message}</span>}
        {pref?.enabled && (!pref.linked || !pref.bot_started) && (
          <a className="mtg-open-bot" href="https://t.me/Hesap95bot" target="_blank" rel="noopener noreferrer">
            Открыть бота <ExternalLink size={13}/>
          </a>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className={"mtg-switch" + (pref?.enabled ? " is-on" : "")}
        aria-label="Уведомления в Telegram"
        aria-checked={Boolean(pref?.enabled)}
        aria-busy={busy}
        disabled={!pref || busy}
        onClick={() => void change()}
        title={pref?.enabled ? "Отключить Telegram-уведомления" : "Включить Telegram-уведомления"}
      >
        <span className="mtg-thumb">
          {busy ? <LoaderCircle size={15} className="mtg-spin"/> : <Bell size={13}/>}
        </span>
      </button>
    </section>,
    mount,
  );
}
