"use client";
import { useEffect, useState } from "react";
type Methods = {
  sbp_phone: string;
  bank_name: string;
  recipient_name: string;
  cash_enabled: boolean;
  cash_instructions: string;
};
export function PaymentMethods({
  edit = false,
  tenantId,
}: {
  edit?: boolean;
  tenantId?: string;
}) {
  const [data, setData] = useState<Methods | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError("");
    fetch("/api/payment-methods", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "Реквизиты пока недоступны. Уточните способ оплаты у предпринимателя.",
          );
        return r.json();
      })
      .then((d) => {
        if (active) {
          setData(d);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);
  if (error && !loaded)
    return (
      <p className="hint" role="status">
        {error}
      </p>
    );
  if (!loaded)
    return (
      <p className="muted" role="status">
        Загружаем способы оплаты…
      </p>
    );
  if (!edit) if (!data) return null;
  if (!edit)
    return (
      <section className="card pad mb">
        <h3>Как оплатить</h3>
        {data?.sbp_phone && (
          <div className="mt">
            <small className="muted">СБП · {data.bank_name}</small>
            <h2>{data.sbp_phone}</h2>
            <p>{data.recipient_name}</p>
            <button
              className="btn btn-outline mt"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.sbp_phone);
                  setNotice("Номер скопирован");
                } catch {
                  setNotice("Выделите номер и скопируйте его вручную");
                }
              }}
            >
              Скопировать номер
            </button>
          </div>
        )}
        {data?.cash_enabled && (
          <p className="mt">
            Наличные:{" "}
            {data.cash_instructions || "согласуйте встречу с предпринимателем"}.
          </p>
        )}
        {!data?.sbp_phone && !data?.cash_enabled && (
          <p className="muted mt">
            Предприниматель ещё не добавил реквизиты. Свяжитесь с ним перед
            оплатой.
          </p>
        )}
        <p className="muted mt">
          Проверьте получателя в приложении банка. После перевода сообщите об
          оплате ниже.
        </p>
        {notice && <p role="status">{notice}</p>}
      </section>
    );
  return (
    <section className="card pad mt">
      <h2>Приём оплаты</h2>
      <p className="muted">Эти реквизиты увидят ваши покупатели.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          const f = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/payment-methods", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sbp_phone: String(f.get("phone")).replace(/[ ()-]/g, ""),
                bank_name: f.get("bank"),
                recipient_name: f.get("recipient"),
                cash_enabled: f.get("cash") === "on",
                cash_instructions: f.get("instructions"),
              }),
            });
            const result = await r.json();
            if (!r.ok) throw Error(result.error);
            setNotice("Способы оплаты сохранены");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Номер СБП
          <input
            name="phone"
            type="tel"
            placeholder="+7 900 000-00-00"
            defaultValue={data?.sbp_phone ?? ""}
          />
        </label>
        <label className="field">
          Банк
          <input
            name="bank"
            maxLength={120}
            defaultValue={data?.bank_name ?? ""}
          />
        </label>
        <label className="field">
          Получатель
          <input
            name="recipient"
            maxLength={120}
            defaultValue={data?.recipient_name ?? ""}
          />
        </label>
        <label className="check">
          <input
            name="cash"
            type="checkbox"
            defaultChecked={data?.cash_enabled ?? true}
          />
          Принимать наличные
        </label>
        <label className="field">
          Как передать наличные
          <textarea
            name="instructions"
            maxLength={500}
            defaultValue={data?.cash_instructions ?? ""}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}
        <button className="btn btn-primary mt" disabled={busy}>
          Сохранить реквизиты
        </button>
      </form>
    </section>
  );
}
