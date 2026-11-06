"use client";
import { useState } from "react";
export function PlatformMerchants({ tenantId }: { tenantId?: string } = {}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invite, setInvite] = useState<{
      code: string;
      url: string;
      expires_at: string;
    } | null>(null);
  return (
    <section className={tenantId ? "mt" : "card pad mb"}>
      {!tenantId && <h2>Подключить предпринимателя</h2>}
      <p className="muted">
        {tenantId
          ? "Код подключает владельца к этому кабинету. Новый код заменяет предыдущий."
          : "Отдельный кабинет, свои клиенты и договоры."}{" "}
        Код действует 24 часа и используется один раз.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setInvite(null);
          const f = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/platform/merchants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                tenantId
                  ? { tenant_id: tenantId }
                  : {
                      name: f.get("name"),
                      owner_name: f.get("owner"),
                    },
              ),
            });
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            setInvite(d);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!tenantId && (
          <>
            <label className="field">
              Название предпринимателя
              <input name="name" minLength={2} maxLength={120} required />
            </label>
            <label className="field">
              Имя владельца
              <input name="owner" minLength={2} maxLength={120} required />
            </label>
          </>
        )}
        <button disabled={busy} className="btn btn-primary full mt">
          {busy
            ? "Готовим код…"
            : tenantId
              ? "Выдать код входа"
              : "Создать кабинет и код"}
        </button>
      </form>
      {tenantId && (
        <button
          className="btn btn-outline mt"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/platform/access", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "revoke_legacy",
                  tenant_id: tenantId,
                }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              setInvite(null);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Отозвать неиспользованный код
        </button>
      )}
      {error && (
        <p className="error mt" role="alert">
          {error}
        </p>
      )}
      {invite && (
        <div className="mt">
          <label className="field">
            Персональный код
            <textarea
              readOnly
              value={invite.code}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <label className="field">
            Ссылка для владельца
            <textarea
              readOnly
              value={invite.url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <p className="hint">
            Передайте лично предпринимателю. Действует до{" "}
            {new Date(invite.expires_at).toLocaleString("ru-RU")}.
          </p>
        </div>
      )}
    </section>
  );
}
