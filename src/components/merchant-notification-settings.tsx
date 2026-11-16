"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft, Bell, BookOpenCheck, CheckCircle2,
  ExternalLink, LoaderCircle, Send, ShieldCheck
} from "lucide-react";

type State = { enabled: boolean; linked: boolean; bot_started: boolean };

export function MerchantNotificationSettings() {
  const [pref, setPref] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(active: () => boolean) {
    try {
      const response = await fetch("/api/telegram/merchant-preference", {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw Error("Не удалось загрузить настройки");
      const data = (await response.json()) as State;
      if (active()) { setPref(data); setError(""); }
    } catch (e) {
      if (active()) setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    const refresh = () => void load(() => active);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);

  async function toggle() {
    if (!pref || saving) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/telegram/merchant-preference", {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !pref.enabled }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.enabled !== "boolean")
        throw Error(data.error || "Не удалось сохранить настройку");
      setPref(data as State);
      setNotice(data.enabled ? "Уведомления включены" : "Уведомления отключены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Настройку не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const enabled = pref?.enabled === true;
  return <div className="mns-page">
    <header className="mns-header">
      <Link className="mns-brand" href="/crm"><BookOpenCheck size={27}/> HESAP</Link>
      <Link className="mns-back" href="/crm"><ArrowLeft size={17}/> Обзор</Link>
    </header>
    <main className="mns-main">
      <p className="mns-eyebrow">HESAP · БИЗНЕС · НАСТРОЙКИ</p>
      <h1>Уведомления</h1>
      <p className="mns-intro">Управляйте уведомлениями о заявках и платежах в своём Telegram. Настройка действует только для вашего аккаунта.</p>
      <section className="mns-card">
        <div className="mns-line">
          <div className="mns-icon"><Send size={22} fill="currentColor" strokeWidth={1.8}/></div>
          <div className="mns-info">
            <strong>Сообщения в Telegram</strong>
            <span>{!pref ? "Загружаем настройку…" :
              !enabled ? "Выключены" :
              !pref.linked ? "Включены · нужна привязка бота" :
              !pref.bot_started ? "Включены · запустите бота" :
              "Включены"}</span>
          </div>
          <button
            className={"mns-switch"+(enabled?" on":"")}
            type="button" role="switch"
            aria-label="Telegram-уведомления"
            aria-checked={enabled}
            aria-busy={saving}
            disabled={!pref || saving}
            onClick={() => void toggle()}>
            <span className="mns-thumb">{saving ? <LoaderCircle size={15} className="mns-spinning"/> : <Bell size={14}/>}</span>
          </button>
        </div>
        <div className="mns-separator"/>
        <div className="mns-status">
          <ShieldCheck size={18}/>
          <span>Переключатель сохраняется автоматически. Уведомления внутри HESAP останутся доступными.</span>
        </div>
        {error && <p className="mns-error" role="alert">{error}</p>}
        {notice && <p className="mns-notice" role="status"><CheckCircle2 size={16}/>{notice}</p>}
      </section>
      <section className="mns-card">
        <div className="mns-sectiontitle"><Bell size={19}/><h2>Подключение бота</h2></div>
        <p>Для получения сообщений откройте HESAP в Telegram и нажмите «Запустить».</p>
        <a href="https://t.me/Hesap95bot" target="_blank" rel="noopener noreferrer" className="mns-botlink">
          <Send size={19}/> Открыть @Hesap95bot <ExternalLink size={16}/>
        </a>
        {pref?.linked && <p className="mns-linked"><CheckCircle2 size={16}/> Аккаунт Telegram привязан</p>}
        {pref && !pref.bot_started && <p className="mns-hint">Бот пока не подтвердил запуск. Нажмите «Старт» в его чате.</p>}
      </section>
      <p className="mns-foot">Выключение прекращает новые сообщения Telegram для вашего аккаунта, но не отключает уведомления покупателей.</p>
      <Link href="/crm" className="mns-return"><ArrowLeft size={16}/> Вернуться в кабинет</Link>
    </main>
  </div>;
}
