"use client";
import { useEffect, useState } from "react";
import type { State } from "@/lib/types";
export function SellerSettings({
  data,
  run,
  busy,
}: {
  data: State;
  run: (action: string, payload: unknown) => Promise<unknown>;
  busy: boolean;
}) {
  const own = data.seller_directory?.find((d) =>
    data.organizations.some((o) => o.id === d.tenant_id),
  );
  const [health, setHealth] = useState<{
    linked: boolean;
    sent: number;
    failed: number;
    pending: number;
  } | null>(null);
  const [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/telegram/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => {});
  }, []);
  return (
    <section className="card pad mt">
      <h2>Мой магазин</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setSaving(true);
          setNotice("");
          try {
            const r = await fetch("/api/shop", { method: "POST", body: f });
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            setNotice("Настройки магазина сохранены.");
          } catch (e) {
            setNotice((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="field">
          Название для покупателей
          <input
            name="name"
            defaultValue={own?.display_name ?? data.organizations[0]?.name}
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label className="field">
          Телефон WhatsApp
          <input
            name="whatsapp"
            type="tel"
            defaultValue={own?.whatsapp_phone ?? ""}
            placeholder="+7 999 123-45-67"
            maxLength={25}
          />
        </label>
        <label className="field">
          Логотип (необязательно)
          <input
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
          />
        </label>
        <small className="muted">PNG, JPEG или WebP до 2 МБ.</small>
        {own?.logo_data && (
          <label className="check">
            <input name="remove_logo" type="checkbox" />
            Убрать текущий логотип
          </label>
        )}
        <label className="check">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={own?.enabled ?? false}
          />
          Принимать заявки от зарегистрированных покупателей
        </label>
        <p className="muted">
          Название появится в списке предпринимателей. Существующие договоры
          останутся доступны при остановке приёма.
        </p>
        <button className="btn btn-primary mt" disabled={busy || saving}>
          {saving ? "Сохраняем…" : "Сохранить магазин"}
        </button>
        {notice && (
          <p role="status" className="hint mt">
            {notice}
          </p>
        )}
      </form>
      {health && (
        <p className="hint mt">
          Telegram владельца:{" "}
          {health.linked
            ? "привязан"
            : "подключите в разделе «Приглашения в Telegram»"}
          . Доставлено: {health.sent}; в очереди: {health.pending}; требуют
          проверки: {health.failed}.
        </p>
      )}
      <button
        className="btn btn-outline mt"
        onClick={() => window.Telegram?.WebApp?.requestWriteAccess?.()}
      >
        Разрешить уведомления в Telegram
      </button>
    </section>
  );
}
