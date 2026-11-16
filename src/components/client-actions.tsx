"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { State } from "@/lib/types";
import { payableContracts } from "@/lib/payment-eligibility";
import { cents, money, today } from "@/lib/money";
import { claimWasReversed } from "@/lib/portfolio";
type Run = (
  action: string,
  payload: unknown,
  notice?: string,
) => Promise<{ id: string } | null>;
const claimLabels = {
  pending: "Ожидает проверки",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
};
const applicationLabels: Record<string, string> = {
  draft: "Черновик",
  review: "На рассмотрении",
  clarification: "Нужно уточнение",
  approved: "Одобрено",
  rejected: "Отклонено",
  awaiting_purchase: "Ожидает закупки",
  purchased: "Товар приобретён",
  ready_to_sell: "Цена согласована",
  contracted: "Договор оформлен",
};
export function ClientActions({
  data,
  run,
  busy,
  view = "all",
  contractId,
}: {
  data: State;
  run: Run;
  busy: boolean;
  view?: "all" | "applications" | "payments";
  contractId?: string;
}) {
  const [error, setError] = useState("");
  const paymentContracts = payableContracts(data).filter(
    (c) => !contractId || c.id === contractId,
  );
  const [selectedPayment, setSelectedPayment] = useState(contractId ?? "");
  const paymentContract =
    paymentContracts.find((c) => c.id === selectedPayment) ??
    paymentContracts[0];
  const pendingClaim = data.payment_claims.find(
    (c) =>
      c.contract_id === paymentContract?.id &&
      c.tenant_id === paymentContract?.tenant_id &&
      c.status === "pending",
  );
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  async function uploadPhoto(id: string, file: File) {
    const tenant =
      data.applications.find((a) => a.id === id)?.tenant_id ??
      data.organizations[0]?.id;
    const f = new FormData();
    f.set("application_id", id);
    f.set("kind", "product_photo");
    f.set("tenant_id", tenant ?? "");
    f.set("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: f });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    router.refresh();
  }
  return (
    <section className="stack mb">
      {view !== "payments" && (
        <>
          <h2>Мои заявки</h2>
          <details
            className="application-compose"
            open={data.applications.length === 0}
          >
            <summary className="btn btn-primary full">+ Новая заявка</summary>
            <form
              className="card pad"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                setError("");
                const selectedPhoto = f.get("photo");
                if (
                  selectedPhoto instanceof File &&
                  selectedPhoto.size > 5 * 1024 * 1024
                ) {
                  setError("Фото должно быть не больше 5 МБ");
                  return;
                }
                try {
                  const result = await run(
                    "portal.application",
                    {
                      product_name: f.get("product_name"),
                      product_url: f.get("product_url"),
                      estimated_cost: cents(String(f.get("cost"))),
                      down_payment: cents(String(f.get("down"))),
                      months: Number(f.get("months")),
                      notes: String(f.get("notes")),
                    },
                    "Заявка отправлена продавцу",
                  );
                  if (result) {
                    const photo = f.get("photo");
                    if (photo instanceof File && photo.size) {
                      setUploading(true);
                      try {
                        await uploadPhoto(result.id, photo);
                      } catch (e) {
                        setError(
                          `Заявка создана, но фото не загружено: ${(e as Error).message}. Добавьте его в карточке ниже.`,
                        );
                      } finally {
                        setUploading(false);
                      }
                    }
                    form.reset();
                  }
                } catch {
                  setError(
                    "Проверьте суммы: используйте рубли, не более двух знаков после запятой.",
                  );
                }
              }}
            >
              <h3>Заявка на товар</h3>
              <label className="field">
                Товар
                <input
                  name="product_name"
                  minLength={2}
                  maxLength={160}
                  required
                />
              </label>
              <label className="field">
                Стоимость, ₽<input name="cost" inputMode="decimal" required />
              </label>
              <details className="mb">
                <summary>Срок, фото и дополнительные пожелания</summary>
                <label className="field">
                  Ссылка на товар
                  <input name="product_url" type="url" />
                </label>
                <label className="field">
                  Первоначальный взнос, ₽
                  <input
                    name="down"
                    inputMode="decimal"
                    defaultValue="0"
                    required
                  />
                </label>
                <label className="field">
                  Фото товара (JPEG или PNG, до 5 МБ)
                  <input
                    type="file"
                    name="photo"
                    accept="image/jpeg,image/png"
                  />
                </label>
                <label className="field">
                  Желаемый срок, месяцев
                  <input
                    name="months"
                    type="number"
                    min={1}
                    max={36}
                    defaultValue={6}
                    required
                  />
                </label>
                <label className="field">
                  Комментарий
                  <textarea name="notes" maxLength={2000} />
                </label>
              </details>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy || uploading}>
                Отправить заявку
              </button>
            </form>
          </details>
          {data.applications.map((a) => (
            <div className="card pad" key={a.id}>
              <strong>{a.product_name}</strong>
              <p>
                {money(a.estimated_cost)} · {a.months} мес.
              </p>
              <p>{applicationLabels[a.status] ?? a.status}</p>
              {(data.application_messages ?? [])
                .filter((m) => m.application_id === a.id)
                .map((m) => (
                  <p className="hint mt" key={m.id}>
                    <strong>
                      {m.author_role === "client" ? "Вы" : "Предприниматель"}:
                    </strong>{" "}
                    {m.message}
                  </p>
                ))}
              {a.status === "clarification" && (
                <form
                  className="mt"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    if (
                      await run(
                        "portal.reply",
                        { id: a.id, message: f.get("message") },
                        "Ответ отправлен предпринимателю",
                      )
                    )
                      form.reset();
                  }}
                >
                  <label className="field">
                    Ваш ответ
                    <textarea
                      name="message"
                      minLength={2}
                      maxLength={2000}
                      required
                    />
                  </label>
                  <button className="btn btn-primary" disabled={busy}>
                    Отправить ответ
                  </button>
                </form>
              )}
              {(data.documents ?? [])
                .filter(
                  (d) =>
                    d.application_id === a.id && d.kind === "product_photo",
                )
                .map((d) => (
                  <a
                    key={d.id}
                    className="btn btn-outline mt"
                    href={`/api/documents/${d.id}`}
                  >
                    Фото: {d.name}
                  </a>
                ))}
              {["review", "clarification"].includes(a.status) && (
                <PhotoForm
                  busy={busy || uploading}
                  upload={async (file) => uploadPhoto(a.id, file)}
                />
              )}
            </div>
          ))}
        </>
      )}
      {view !== "applications" && (
        <>
          {paymentContracts.length > 0 && (
            <>
              <h2>Сообщить об оплате</h2>
              <p className="hint">
                Сначала переведите деньги по реквизитам, согласованным с
                продавцом, или передайте ему наличные. Здесь вы сообщаете о
                состоявшейся оплате. Остаток долга изменится после проверки.
                Автоматическая оплата СБП пока не подключена.
              </p>
            </>
          )}
          {paymentContracts.length > 0 && (
            <form
              className="card pad"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                setError("");
                try {
                  if (pendingClaim) {
                    setError(
                      "Предыдущее сообщение уже на проверке у продавца.",
                    );
                    return;
                  }
                  const result = await run(
                    "portal.claim",
                    {
                      contract_id: f.get("contract_id"),
                      amount: cents(String(f.get("amount"))),
                      method: f.get("method"),
                      paid_on: f.get("paid_on"),
                    },
                    "Сообщение отправлено на проверку",
                  );
                  if (result) {
                    const amount = form.elements.namedItem("amount");
                    if (amount instanceof HTMLInputElement) amount.value = "";
                  } else
                    setError(
                      "Не удалось отправить сообщение. Проверьте данные и повторите попытку.",
                    );
                } catch {
                  setError("Проверьте сумму платежа.");
                }
              }}
            >
              <label className="field">
                Договор
                <select
                  name="contract_id"
                  value={paymentContract?.id ?? ""}
                  onChange={(e) => {
                    setSelectedPayment(e.target.value);
                    setError("");
                  }}
                >
                  {paymentContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number}
                    </option>
                  ))}
                </select>
              </label>
              {pendingClaim && (
                <p className="hint mb" role="status">
                  Продавец проверяет ваше сообщение на{" "}
                  {money(pendingClaim.amount)}. Повторно отправлять его не
                  нужно.
                </p>
              )}
              <label className="field">
                Сумма, ₽<input name="amount" inputMode="decimal" required />
              </label>
              <label className="field">
                Способ
                <select name="method">
                  <option value="sbp">Перевод СБП</option>
                  <option value="cash">Наличные переданы продавцу</option>
                </select>
              </label>
              <label className="field">
                Дата оплаты
                <input
                  name="paid_on"
                  type="date"
                  max={today()}
                  defaultValue={today()}
                  required
                />
              </label>
              <button
                className="btn btn-primary"
                disabled={busy || !!pendingClaim}
              >
                {pendingClaim
                  ? "Сообщение на проверке"
                  : busy
                    ? "Отправляем…"
                    : "Я оплатил — отправить на проверку"}
              </button>
              {error && (
                <p role="alert" className="error mt">
                  {error}
                </p>
              )}
            </form>
          )}
          {(data.payment_claims ?? [])
            .filter((c) => !contractId || c.contract_id === contractId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((c) => (
              <div className="card pad" key={c.id}>
                <strong>
                  {money(c.amount)} · {c.method === "cash" ? "Наличные" : "СБП"}
                </strong>
                <p>
                  {data.contracts.find((x) => x.id === c.contract_id)?.number} ·{" "}
                  {claimWasReversed(data, c)
                    ? "Поступление отменено"
                    : claimLabels[c.status]}
                </p>
                <small className="muted">
                  Дата оплаты:{" "}
                  {new Date(c.paid_on + "T00:00:00").toLocaleDateString(
                    "ru-RU",
                  )}
                </small>
                {claimWasReversed(data, c) && (
                  <p className="hint mt">
                    Продавец отменил запись о поступлении. Сумма снова
                    учитывается в остатке долга.
                  </p>
                )}
                {c.reason && <p>{c.reason}</p>}
              </div>
            ))}
        </>
      )}
    </section>
  );
}
function PhotoForm({
  busy,
  upload,
}: {
  busy: boolean;
  upload: (file: File) => Promise<void>;
}) {
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="mt"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const file = new FormData(form).get("photo");
        if (!(file instanceof File) || !file.size) return;
        setPending(true);
        setMessage("");
        try {
          await upload(file);
          setMessage("Фото добавлено к заявке");
          form.reset();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field">
        Добавить фото товара
        <input
          name="photo"
          type="file"
          accept="image/jpeg,image/png"
          required
        />
      </label>
      <button className="btn btn-outline" disabled={busy || pending}>
        Добавить фото
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
