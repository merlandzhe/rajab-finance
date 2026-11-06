"use client";
import { useEffect, useState } from "react";
import type { State } from "@/lib/types";
import { metrics } from "@/lib/metrics";
import { money } from "@/lib/money";

async function request(body?: unknown) {
  const r = await fetch(
    "/api/overdue-registry",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Не удалось загрузить чёрный список");
  return d;
}
export function AddOverdueReport({
  data,
  customerId,
}: {
  data: State;
  customerId: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const contracts = data.contracts.filter(
    (c) =>
      c.customer_id === customerId &&
      ["signed", "transferred"].includes(c.status) &&
      BigInt(metrics(data, [c]).overdue) > 0n,
  );
  if (!contracts.length) return null;
  return (
    <section className="card pad mb">
      <h3>Просроченные платежи</h3>
      <p className="muted mt">
        Можно вручную добавить сведения в общий чёрный список предпринимателей HESAP.
      </p>
      {!open ? (
        <button className="btn btn-outline mt" onClick={() => setOpen(true)}>
          Добавить в чёрный список
        </button>
      ) : (
        <form
          className="stack mt"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setNotice("");
            try {
              await request({
                action: "add",
                contract_id: f.get("contract"),
                basis: f.get("basis"),
                confirm: f.get("confirm") === "on",
              });
              setOpen(false);
              setNotice(
                "Запись сохранена в общем чёрном списке. Повторная запись по тому же договору не создаётся.",
              );
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Договор
            <select name="contract">
              {contracts.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.number} · просрочено {money(metrics(data, [c]).overdue)}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Другие предприниматели увидят магазин, сумму и срок просрочки при
            поиске по телефону клиента. Проверьте поступления денег и сообщения
            об оплате перед добавлением.
          </p>
          <label className="field">
            Основание передачи данных
            <input
              name="basis"
              required
              minLength={5}
              maxLength={200}
              placeholder="Например, номер и дата согласия клиента"
            />
          </label>
          <label className="check">
            <input name="confirm" type="checkbox" required />
            Подтверждаю достоверность сведений, наличие основания для передачи
            данных и уведомление клиента.
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Проверяем…" : "Подтвердить добавление"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="hint mt">
          {notice}
        </p>
      )}
    </section>
  );
}
type Row = {
  id: string;
  name: string;
  company: string;
  phone: string | null;
  amount: string;
  reported_amount: string;
  days: number;
  status: string;
  disputed: boolean;
  can_withdraw: boolean;
  can_dispute: boolean;
  created_at: string;
  dispute_reason: string | null;
  withdrawal_reason: string | null;
  basis_reference: string | null;
};
const labels: Record<string, string> = {
  overdue: "Есть просрочка",
  disputed: "Оспаривается клиентом",
  resolved: "Просрочка погашена",
  withdrawn: "Запись отозвана",
};
export function OverdueRegistry({ merchant = false }: { merchant?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  async function own() {
    setBusy(true);
    setError("");
    try {
      setRows(await request());
      setSearched(false);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void own();
  }, []);
  return (
    <section className="card pad mb">
      <h2>Чёрный список</h2>
      <p className="muted mt">
        {merchant
          ? "Сведения, добавленные предпринимателями вручную. Поиск по точному номеру телефона — до 30 проверок в сутки."
          : "Здесь показаны записи продавцов о ваших просрочках. Вы можете оспорить неточность."}
      </p>
      {merchant && (
        <form
          className="stack mt"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            setRows([]);
            setLoaded(false);
            try {
              setRows(
                await request({
                  action: "search",
                  phone: f.get("phone"),
                  purpose: f.get("purpose") === "on",
                }),
              );
              setSearched(true);
              setLoaded(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Телефон клиента
            <input
              name="phone"
              type="tel"
              placeholder="+7 999 123-45-67"
              required
              minLength={11}
              maxLength={25}
            />
          </label>
          <label className="check">
            <input type="checkbox" name="purpose" required />
            Проверяю клиента для рассмотрения его заявки и имею основание для
            обработки данных.
          </label>
          <div className="row">
            <button disabled={busy} className="btn btn-primary">
              Проверить
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn btn-outline"
              onClick={() => void own()}
            >
              Мои записи
            </button>
          </div>
        </form>
      )}
      {busy && (
        <p role="status" className="muted mt">
          Загрузка…
        </p>
      )}
      {error && (
        <p role="alert" className="error mt">
          {error}
        </p>
      )}
      {loaded && !busy && !rows.length && (
        <p className="hint mt">
          {searched
            ? "Записей по этому номеру не найдено. Это не подтверждает отсутствие задолженностей."
            : "Записей пока нет."}
        </p>
      )}
      {rows.map((r) => (
        <article className="card pad mt" key={r.id}>
          <h3>
            {r.name} · {r.company}
          </h3>
          {r.phone && <p>{r.phone}</p>}
          <p className="mt">
            <strong>{labels[r.status]}</strong>
            {r.disputed && r.status !== "disputed" ? " · есть оспаривание" : ""}
          </p>
          <p>
            Просрочено: {money(r.amount)}
            {r.days > 0 ? ` · ${r.days} дн.` : ""}
          </p>
          <p className="muted">
            При добавлении: {money(r.reported_amount)} ·{" "}
            {new Date(r.created_at).toLocaleDateString("ru-RU")}
          </p>
          {r.dispute_reason && (
            <p className="hint mt">Оспаривание: {r.dispute_reason}</p>
          )}
          {r.withdrawal_reason && (
            <p className="hint mt">Причина отзыва: {r.withdrawal_reason}</p>
          )}
          {r.basis_reference && (
            <p className="muted mt">Основание: {r.basis_reference}</p>
          )}
          {(r.can_withdraw || r.can_dispute) && (
            <form
              className="stack mt"
              onSubmit={async (e) => {
                e.preventDefault();
                const reason = new FormData(e.currentTarget).get("reason");
                setBusy(true);
                setError("");
                try {
                  await request({
                    action: r.can_dispute ? "dispute" : "withdraw",
                    id: r.id,
                    reason,
                  });
                  await own();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                {r.can_dispute ? "Что нужно исправить?" : "Причина отзыва"}
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                />
              </label>
              <button disabled={busy} className="btn btn-outline">
                {r.can_dispute
                  ? "Оспорить запись"
                  : "Отозвать из общего чёрного списка"}
              </button>
            </form>
          )}
        </article>
      ))}
      <p className="hint mt">
        Данные предоставлены продавцом, спорные записи отмечены отдельно.
        Совпадение телефона само по себе не подтверждает личность. Чёрный список не
        принимает решение об одобрении рассрочки.
      </p>
      {!merchant && (
        <a
          className="btn btn-ghost mt"
          href="https://t.me/merlandzhe"
          target="_blank"
          rel="noreferrer"
        >
          Обратиться к владельцу HESAP
        </a>
      )}
    </section>
  );
}
