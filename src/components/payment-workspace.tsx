"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CheckCheck, Search, Wallet, X } from "lucide-react";
import { FilterChips } from "./filter-chips";
import { matchesSearch } from "@/lib/cabinet-overview";
import { claimWasReversed, paymentEntries } from "@/lib/portfolio";
import { money, sum, today } from "@/lib/money";
import type { Payment, State } from "@/lib/types";

type Run = (
  action: string,
  payload: unknown,
  notice?: string,
) => Promise<{ id: string } | null>;
type View = "review" | "history" | "record";
const date = (value: string) =>
  new Date(value.slice(0, 10) + "T00:00:00").toLocaleDateString("ru-RU");
const claimLabels = {
  pending: "На проверке",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
};

export function PaymentWorkspace({
  data,
  run,
  busy,
  owner,
  form,
}: {
  data: State;
  run: Run;
  busy: boolean;
  owner: boolean;
  form: ReactNode;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("view");
  const view: View =
    requested === "history" || requested === "record" ? requested : "review";
  const pending = data.payment_claims.filter(
    (c) => c.status === "pending",
  ).length;
  return (
    <section className="finance-workspace">
      <div className="page-heading">
        <div>
          <h1>Платежи</h1>
          <p>Проверяйте поступления и следите за историей</p>
        </div>
      </div>
      <FilterChips<View>
        label="Раздел платежей"
        value={view}
        onChange={(v) =>
          router.push("/crm/payments?view=" + v, { scroll: false })
        }
        options={[
          { value: "review", label: "На проверке", count: pending },
          { value: "history", label: "История" },
          { value: "record", label: "Записать платёж" },
        ]}
      />
      <div className="mt">
        {view === "review" && (
          <PaymentReview data={data} run={run} busy={busy} />
        )}
        {view === "history" && (
          <PaymentHistory data={data} run={run} busy={busy} owner={owner} />
        )}
        {view === "record" && (
          <section className="card pad finance-entry">
            <h2>Новое поступление</h2>
            <p className="prose-note mb">
              Запишите деньги, которые уже поступили в банк или получены
              наличными.
            </p>
            {form}
          </section>
        )}
      </div>
    </section>
  );
}

function PaymentReview({
  data,
  run,
  busy,
}: {
  data: State;
  run: Run;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"pending" | "processed">("pending");
  const [limit, setLimit] = useState(12);
  const claims = data.payment_claims.flatMap((claim) => {
    const contract = data.contracts.find(
      (c) => c.id === claim.contract_id && c.tenant_id === claim.tenant_id,
    );
    if (!contract) return [];
    const customer = data.customers.find(
      (c) =>
        c.id === contract.customer_id && c.tenant_id === contract.tenant_id,
    );
    const product =
      data.contract_items.find(
        (c) =>
          c.contract_id === contract.id && c.tenant_id === contract.tenant_id,
      )?.product_name ?? "";
    return [{ claim, contract, customer, product }];
  });
  const rows = claims
    .filter(
      (r) =>
        (filter === "pending"
          ? r.claim.status === "pending"
          : r.claim.status !== "pending") &&
        matchesSearch(search, [
          r.customer?.name,
          r.customer?.phone,
          r.contract.number,
          r.product,
        ]),
    )
    .sort((a, b) =>
      filter === "pending"
        ? a.claim.created_at.localeCompare(b.claim.created_at)
        : b.claim.created_at.localeCompare(a.claim.created_at),
    );
  return (
    <>
      <div className="finance-subheading">
        <h2>Сообщения клиентов</h2>
        <select
          aria-label="Статус сообщений об оплате"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setLimit(12);
          }}
        >
          <option value="pending">Ожидают проверки</option>
          <option value="processed">Уже рассмотрены</option>
        </select>
      </div>
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label="Поиск сообщений об оплате"
          placeholder="Клиент, телефон или договор"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(12);
          }}
        />
      </label>
      {filter === "pending" && (
        <p className="finance-explanation">
          Сообщение клиента ещё не подтверждает оплату. Сверьте сумму с
          поступлением в банке или полученными наличными.
        </p>
      )}
      <div className="finance-claim-list">
        {rows.slice(0, limit).map((row) => (
          <ClaimCard
            key={row.claim.id}
            data={data}
            row={row}
            run={run}
            busy={busy}
          />
        ))}
      </div>
      {!rows.length && (
        <div className="pocket-empty">
          <CheckCheck size={30} />
          <h3>
            {search
              ? "Ничего не найдено"
              : filter === "pending"
                ? "Все сообщения проверены"
                : "Рассмотренных сообщений пока нет"}
          </h3>
          <p>
            {search
              ? "Попробуйте другое имя, номер или договор."
              : "Когда клиент сообщит об оплате, запись появится здесь."}
          </p>
        </div>
      )}
      {rows.length > limit && (
        <button
          className="btn btn-outline full mt"
          onClick={() => setLimit((v) => v + 12)}
        >
          Показать ещё
        </button>
      )}
    </>
  );
}

function ClaimCard({
  data,
  row,
  run,
  busy,
}: {
  data: State;
  row: {
    claim: State["payment_claims"][number];
    contract: State["contracts"][number];
    customer?: State["customers"][number];
    product: string;
  };
  run: Run;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"confirm" | "reject" | null>(null);
  const [error, setError] = useState("");
  const { claim, contract, customer, product } = row;
  const reversed = claimWasReversed(data, claim);
  const accounts = data.cash_accounts.filter(
    (a) => a.tenant_id === claim.tenant_id,
  );
  return (
    <article className="card finance-claim">
      <div className="row between wrap">
        <span
          className={
            "badge " +
            (claim.status === "pending"
              ? "warn"
              : claim.status === "rejected" || reversed
                ? "danger"
                : "")
          }
        >
          {reversed ? "Поступление отменено" : claimLabels[claim.status]}
        </span>
        <small>{date(claim.created_at)}</small>
      </div>
      <div className="finance-claim-title">
        <h3>{customer?.name ?? "Клиент договора"}</h3>
        <strong>{money(claim.amount)}</strong>
      </div>
      <p className="finance-product">{product}</p>
      <div className="finance-claim-meta">
        <span>
          {claim.method === "sbp" ? "Перевод СБП" : "Наличные"} ·{" "}
          {date(claim.paid_on)}
        </span>
        <Link href={"/crm/contracts/" + contract.id}>
          {contract.number} <ArrowUpRight size={14} />
        </Link>
      </div>
      {claim.reason && <p className="hint mt">{claim.reason}</p>}
      {reversed && (
        <p className="hint mt">
          Подтверждение сохранено в истории. После отмены поступления сумма
          снова учитывается в долге.
        </p>
      )}
      {claim.status === "pending" && (
        <>
          {mode === null ? (
            <button
              className="btn btn-outline full mt"
              onClick={() => setMode("confirm")}
            >
              Проверить поступление
            </button>
          ) : (
            <div className="claim-decision">
              <div className="row between">
                <strong>
                  {mode === "confirm"
                    ? "Подтверждение оплаты"
                    : "Причина отклонения"}
                </strong>
                <button
                  className="btn btn-ghost btn-icon"
                  aria-label="Закрыть проверку"
                  disabled={busy}
                  onClick={() => {
                    setMode(null);
                    setError("");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              {mode === "confirm" ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError("");
                    const f = new FormData(e.currentTarget);
                    if (
                      !(await run(
                        "portal.confirm",
                        { id: claim.id, cash_account_id: f.get("account") },
                        "Оплата подтверждена и учтена",
                      ))
                    )
                      setError(
                        "Не удалось подтвердить. Проверьте сообщение об ошибке и повторите попытку.",
                      );
                  }}
                >
                  <label className="field">
                    Куда поступили деньги
                    <select name="account" required defaultValue="">
                      <option value="" disabled>
                        Выберите счёт или кассу
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check">
                    <input name="verified" type="checkbox" required />
                    <span>
                      Проверил поступление {money(claim.amount)} от этого
                      клиента
                    </span>
                  </label>
                  {!accounts.length && (
                    <p className="hint mb">
                      Добавьте счёт для учёта поступлений в настройках компании.
                    </p>
                  )}
                  <button
                    className="btn btn-primary full"
                    disabled={busy || !accounts.length}
                  >
                    {busy ? "Сохраняем…" : "Подтвердить оплату"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost full mt"
                    disabled={busy}
                    onClick={() => {
                      setMode("reject");
                      setError("");
                    }}
                  >
                    Деньги не поступили
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError("");
                    const f = new FormData(e.currentTarget);
                    if (
                      !(await run(
                        "portal.reject",
                        { id: claim.id, reason: f.get("reason") },
                        "Сообщение отклонено. Клиент увидит причину",
                      ))
                    )
                      setError(
                        "Не удалось сохранить решение. Повторите попытку.",
                      );
                  }}
                >
                  <label className="field">
                    Что сообщить клиенту?
                    <textarea
                      name="reason"
                      required
                      minLength={5}
                      maxLength={1000}
                      placeholder="Например: перевод пока не найден, проверьте получателя"
                    />
                  </label>
                  <p className="prose-note mb">
                    Долг не изменится. Клиент сможет отправить новое сообщение
                    об оплате.
                  </p>
                  <button className="btn btn-outline full" disabled={busy}>
                    {busy ? "Сохраняем…" : "Отклонить сообщение"}
                  </button>
                  <button
                    className="btn btn-ghost full mt"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMode("confirm");
                      setError("");
                    }}
                  >
                    Вернуться к подтверждению
                  </button>
                </form>
              )}
              {error && (
                <p className="error mt" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function PaymentHistory({
  data,
  run,
  busy,
  owner,
}: {
  data: State;
  run: Run;
  busy: boolean;
  owner: boolean;
}) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(20);
  const [reverse, setReverse] = useState<Payment | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const invalidRange = !!from && !!to && from > to;
  const all = paymentEntries(data);
  const rows = invalidRange
    ? []
    : all.filter(
        (r) =>
          (!from || r.payment.paid_on >= from) &&
          (!to || r.payment.paid_on <= to) &&
          matchesSearch(search, [
            r.customer?.name,
            r.customer?.phone,
            r.contract.number,
            r.product,
            r.account,
            r.payment.id,
          ]),
      );
  const selected = all.find((r) => r.payment.id === reverse?.id);
  function close() {
    dialog.current?.close();
    setReverse(null);
    setError("");
  }
  return (
    <>
      <h2 className="mb">История поступлений</h2>
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label="Поиск поступлений"
          placeholder="Клиент, договор, товар или счёт"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(20);
          }}
        />
      </label>
      <div className="finance-dates">
        <label className="field">
          С даты
          <input
            type="date"
            aria-label="Поступления с даты"
            value={from}
            max={to || today()}
            onChange={(e) => {
              setFrom(e.target.value);
              setLimit(20);
            }}
          />
        </label>
        <label className="field">
          По дату
          <input
            type="date"
            aria-label="Поступления по дату"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => {
              setTo(e.target.value);
              setLimit(20);
            }}
          />
        </label>
        {(from || to || search) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              setFrom("");
              setTo("");
              setLimit(20);
            }}
          >
            Сбросить
          </button>
        )}
      </div>
      {invalidRange && (
        <p className="error" role="alert">
          Начало периода должно быть не позже окончания.
        </p>
      )}
      <div className="portfolio-totals" aria-live="polite">
        <span>
          Операций <b>{rows.length}</b>
        </span>
        <span>
          Итого с учётом отмен{" "}
          <b>{money(sum(rows.map((r) => r.payment.amount)))}</b>
        </span>
      </div>
      <div className="finance-history">
        {rows.slice(0, limit).map((r) => (
          <article className="card finance-payment" key={r.payment.id}>
            <div className="finance-payment-top">
              <div>
                <span
                  className={
                    "badge " +
                    (r.payment.reversal_of || r.reversal ? "danger" : "")
                  }
                >
                  {r.payment.reversal_of
                    ? "Операция отмены"
                    : r.reversal
                      ? "Поступление отменено"
                      : "Поступление"}
                </span>
                <small>{date(r.payment.paid_on)}</small>
              </div>
              <strong>{money(r.payment.amount)}</strong>
            </div>
            <h3>{r.customer?.name ?? "Клиент договора"}</h3>
            <p className="finance-product">{r.product}</p>
            <div className="finance-claim-meta">
              <span>{r.account}</span>
              <Link href={"/crm/contracts/" + r.contract.id}>
                {r.contract.number} <ArrowUpRight size={14} />
              </Link>
            </div>
            {r.payment.reason && <p className="hint mt">{r.payment.reason}</p>}
            {r.reversal && (
              <p className="finance-reversal-note">
                Отменено {date(r.reversal.paid_on)}: {r.reversal.reason}
              </p>
            )}
            {owner && !r.payment.reversal_of && !r.reversal && (
              <button
                className="finance-cancel"
                onClick={() => {
                  setReverse(r.payment);
                  setError("");
                  dialog.current?.showModal();
                }}
              >
                Отменить ошибочную запись
              </button>
            )}
          </article>
        ))}
      </div>
      {!rows.length && !invalidRange && (
        <div className="pocket-empty">
          <Wallet size={30} />
          <h3>
            {all.length ? "Поступления не найдены" : "История пока пуста"}
          </h3>
          <p>
            {all.length
              ? "Измените период или поисковый запрос."
              : "Подтверждённые оплаты и записанные поступления появятся здесь."}
          </p>
        </div>
      )}
      {rows.length > limit && (
        <button
          className="btn btn-outline full mt"
          onClick={() => setLimit((v) => v + 20)}
        >
          Показать ещё
        </button>
      )}
      <dialog
        className="finance-dialog"
        ref={dialog}
        aria-labelledby="reverse-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else {
            setReverse(null);
            setError("");
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) close();
        }}
      >
        {reverse && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const f = new FormData(e.currentTarget);
              if (
                await run(
                  "payment.reverse",
                  { id: reverse.id, reason: f.get("reason") },
                  "Ошибочное поступление отменено. История сохранена",
                )
              )
                close();
              else
                setError(
                  "Не удалось отменить поступление. Проверьте данные и повторите попытку.",
                );
            }}
          >
            <div className="row between">
              <h2 id="reverse-title">Отменить поступление?</h2>
              <button
                className="btn btn-ghost btn-icon"
                type="button"
                aria-label="Закрыть отмену"
                disabled={busy}
                onClick={close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="finance-reverse-summary">
              <strong>{money(reverse.amount)}</strong>
              <span>
                {selected?.customer?.name} · {selected?.contract.number}
              </span>
              <small>
                {date(reverse.paid_on)} · {selected?.account}
              </small>
            </div>
            <p className="prose-note mb">
              Долг клиента увеличится на эту сумму. Исходная запись останется в
              истории. Деньги через банк не возвращаются.
            </p>
            <label className="field">
              Причина отмены
              <textarea name="reason" minLength={5} maxLength={1000} required />
            </label>
            {error && (
              <p className="error mb" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-danger full" disabled={busy}>
              {busy ? "Сохраняем…" : "Подтвердить отмену записи"}
            </button>
            <button
              className="btn btn-outline full mt"
              type="button"
              disabled={busy}
              onClick={close}
            >
              Оставить поступление
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
