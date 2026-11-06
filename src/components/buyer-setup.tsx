"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShopContact } from "./shop-contact";
type BuyerData = {
  profile: {
    name: string;
    city: string;
    phone: string | null;
    phone_verified_at: string | null;
    consent_at: string | null;
    active_tenant: string | null;
  } | null;
  sellers: {
    tenant_id: string;
    display_name: string;
    enabled: boolean;
    whatsapp_phone?: string;
    logo_data?: string;
  }[];
};
export function BuyerSetup({
  mode = "phone",
}: {
  mode?: "phone" | "application" | "profile" | "seller";
}) {
  const router = useRouter();
  const [data, setData] = useState<BuyerData | null>(null);
  const sellerStep = useRef<HTMLElement>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [busy, setBusy] = useState(false),
    [waiting, setWaiting] = useState(false),
    [error, setError] = useState("");
  async function load() {
    const r = await fetch("/api/buyer", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setData(body);
    if (body.profile?.phone_verified_at) setWaiting(false);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (mode === "phone" && data?.profile?.phone_verified_at) {
      router.replace("/cabinet");
      router.refresh();
    }
  }, [mode, data?.profile?.phone_verified_at, router]);
  useEffect(() => {
    if (!profileSaved) return;
    sellerStep.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    sellerStep.current?.focus({ preventScroll: true });
  }, [profileSaved]);
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(() => {
      load().catch((e) => setError(e.message));
    }, 3000);
    const end = setTimeout(() => {
      setWaiting(false);
      setError(
        "Контакт пока не получен. Нажмите «Проверить подтверждение» или повторите передачу номера.",
      );
    }, 90000);
    return () => {
      clearInterval(poll);
      clearTimeout(end);
    };
  }, [waiting]);
  async function post(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if ((body as { action?: string }).action !== "select") await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const p = data?.profile;
  return (
    <section className="stack mt buyer-setup">
      <span className="eyebrow">Кабинет покупателя</span>
      <h1>
        {mode === "phone"
          ? "Ваш личный кабинет"
          : mode === "seller"
            ? "Выберите продавца"
            : mode === "application"
              ? "Новая рассрочка"
              : "Мой профиль"}
      </h1>
      <p className="muted">
        {mode === "phone"
          ? "Один шаг — подтвердите номер в Telegram."
          : mode === "seller"
            ? "Переключайтесь между продавцами. Договоры и платежи сохраняются у каждого из них."
            : mode === "application"
              ? "Укажите данные для заявки и выберите предпринимателя."
              : "Здесь можно изменить данные для ваших заявок."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Загружаем профиль…</p>}
      {data && !p && (
        <p className="hint">
          Этот кабинет создан по приглашению.{" "}
          <Link href="/cabinet">Вернуться к договорам</Link>. Самостоятельная
          регистрация доступна новым покупателям через Telegram.
        </p>
      )}
      {p && (
        <>
          <section className="card pad">
            <h2>Номер телефона</h2>
            <p>
              {p.phone_verified_at
                ? `Подтверждён: ${p.phone}`
                : "Telegram попросит разрешение передать ваш номер."}
            </p>
            {!p.phone_verified_at && (
              <>
                <button
                  className="btn btn-primary mt"
                  disabled={busy || waiting}
                  onClick={async () => {
                    const app = window.Telegram?.WebApp;
                    if (!app?.initData || !app.requestContact) {
                      setError(
                        "Откройте кабинет внутри обновлённого приложения Telegram.",
                      );
                      return;
                    }
                    if (await post({ action: "phone" })) {
                      setWaiting(true);
                      app.requestContact((shared) => {
                        if (!shared) {
                          setWaiting(false);
                          setError(
                            "Номер не передан. Подтвердите свой контакт, чтобы продолжить.",
                          );
                        }
                      });
                    }
                  }}
                >
                  {waiting
                    ? "Ожидаем подтверждение от Telegram…"
                    : "Подтвердить номер"}
                </button>
                {waiting && (
                  <button
                    className="btn btn-ghost mt"
                    onClick={() => load().catch((e) => setError(e.message))}
                  >
                    Проверить подтверждение
                  </button>
                )}
              </>
            )}
          </section>
          {p.phone_verified_at &&
            mode !== "phone" &&
            (mode !== "seller" || !p.consent_at) && (
              <form
                className="card pad"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setProfileSaved(false);
                  const f = new FormData(e.currentTarget);
                  const saved = await post({
                    action: "profile",
                    name: f.get("name"),
                    city: f.get("city"),
                    consent: f.get("consent") === "on",
                  });
                  if (saved) {
                    setProfileSaved(true);
                    if (mode === "profile") {
                      router.push("/cabinet?view=profile");
                      router.refresh();
                    }
                  }
                }}
              >
                <h2>Данные покупателя</h2>
                <label className="field">
                  Имя и фамилия
                  <input
                    name="name"
                    autoComplete="name"
                    defaultValue={p.name}
                    minLength={2}
                    maxLength={120}
                    required
                  />
                </label>
                <label className="field">
                  Город
                  <input
                    name="city"
                    autoComplete="address-level2"
                    defaultValue={p.city}
                    minLength={2}
                    maxLength={120}
                    required
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    name="consent"
                    required
                    defaultChecked={!!p.consent_at}
                  />
                  Согласен на обработку профиля и передачу данных выбранному
                  предпринимателю для рассмотрения заявки.
                </label>
                <Link href="/privacy">Условия обработки данных</Link>
                <button className="btn btn-primary mt" disabled={busy}>
                  {busy ? "Сохраняем…" : "Сохранить профиль"}
                </button>
                {error && (
                  <p className="error mt" role="alert">
                    {error}
                  </p>
                )}
                {profileSaved && (
                  <p className="hint mt" role="status">
                    Профиль сохранён.
                  </p>
                )}
              </form>
            )}
          {p.consent_at && (mode === "application" || mode === "seller") && (
            <section
              className="card pad"
              ref={sellerStep}
              tabIndex={-1}
              aria-labelledby="seller-step-title"
              style={{ scrollMarginTop: "24px" }}
            >
              <h2 id="seller-step-title">Выберите предпринимателя</h2>
              <p className="muted">
                У каждого продавца свои заявки, договоры и платежи.
              </p>
              {data.sellers.length === 0 && (
                <p className="hint">
                  Ваш профиль сохранён. Предприниматели пока не открыли приём
                  заявок. Повторно заполнять профиль не нужно — вернитесь, когда
                  продавец подключится.
                </p>
              )}
              {data.sellers.map((s) => (
                <div key={s.tenant_id} className="seller-card mt">
                  <ShopContact shop={s} />
                  <button
                    key={s.tenant_id}
                    disabled={busy}
                    className="btn btn-outline full mt"
                    onClick={async () => {
                      if (
                        await post({ action: "select", tenant_id: s.tenant_id })
                      ) {
                        window.location.replace("/cabinet?view=applications");
                      }
                    }}
                  >
                    {s.display_name}
                    {p.active_tenant === s.tenant_id ? " · выбран" : ""}
                    {!s.enabled ? " · только действующие договоры" : ""} →
                  </button>
                </div>
              ))}
            </section>
          )}
          <details className="card pad notification-settings">
            <summary>Уведомления в Telegram</summary>
            <p>Статусы заявок, подтверждения и напоминания о платежах.</p>
            <button
              className="btn btn-outline mt"
              onClick={() => {
                const app = window.Telegram?.WebApp;
                if (!app?.requestWriteAccess) {
                  setError("Разрешите сообщения от бота внутри Telegram.");
                  return;
                }
                app.requestWriteAccess((allowed) => {
                  if (!allowed)
                    setError(
                      "Сообщения не разрешены. Статусы останутся доступны в кабинете.",
                    );
                });
              }}
            >
              Разрешить сообщения бота
            </button>
          </details>
        </>
      )}
    </section>
  );
}
