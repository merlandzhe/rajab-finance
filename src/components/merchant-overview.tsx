"use client";
import { useState } from "react";
import Link from "next/link";
import { Clock, Search, ChevronRight } from "lucide-react";
import type { State, Session } from "@/lib/types";
import { metrics } from "@/lib/metrics";
import { money, today, sum } from "@/lib/money";
import {
  matchesPeriod,
  matchesSearch,
  scheduleOverview,
  type PaymentPeriod,
} from "@/lib/cabinet-overview";
import { FilterChips } from "./filter-chips";

export function MerchantOverview({
  data,
  session,
}: {
  data: State;
  session: Session;
}) {
  const [period, setPeriod] = useState<PaymentPeriod>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(6);
  const m = metrics(data);
  const canReview = session.role === "owner" || session.role === "manager";
  const canReceive = session.role === "owner" || session.role === "cashier";
  const incoming = data.applications
    .filter((a) => a.status === "review")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pending = data.payment_claims.filter((p) => p.status === "pending");
  const day = today();
  const due = scheduleOverview(data, day).filter((p) => !p.paid);
  const rows = due.filter(
    (p) =>
      matchesPeriod(p, period, day) &&
      matchesSearch(search, [
        p.customer?.name,
        p.customer?.phone,
        p.contract.number,
        p.product,
      ]),
  );
  const periods: { value: PaymentPeriod; label: string }[] = [
    { value: "all", label: "Все" },
    { value: "today", label: "Сегодня" },
    { value: "week", label: "7 дней" },
    { value: "overdue", label: "Просрочены" },
  ];
  return (
    <div className="merchant-overview">
      <div className="pocket-heading">
        <span className="eyebrow">Кабинет предпринимателя</span>
        <h1>{data.organizations[0]?.name ?? session.name}</h1>
        <p className="muted">
          {new Date(day + "T12:00:00Z").toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "Europe/Moscow",
          })}
        </p>
      </div>
      <section className="merchant-queue">
        <h2>Требуют внимания</h2>
        {canReview && incoming.length > 0 && (
          <Link href="/crm/applications?status=review">
            <span>Заявки на рассмотрении</span>
            <b>{incoming.length}</b>
            <ChevronRight size={16} />
          </Link>
        )}
        {canReceive && pending.length > 0 && (
          <Link href="/crm/payments">
            <span>Оплаты на проверку</span>
            <b>{pending.length}</b>
            <ChevronRight size={16} />
          </Link>
        )}
        {!(canReview && incoming.length) && !(canReceive && pending.length) && (
          <p className="muted">Сейчас проверять нечего.</p>
        )}
      </section>
      <section className="balance-card">
        <span>Ожидается по договорам</span>
        <strong>{money(m.debt)}</strong>
        <div className="balance-footer">
          <div>
            <small>Просрочено</small>
            <b>{money(m.overdue)}</b>
          </div>
          <div>
            <small>Сегодня</small>
            <b>{money(m.today)}</b>
          </div>
        </div>
      </section>
      <details className="merchant-fold">
        <summary>
          <Clock size={18} />
          <span>Календарь платежей</span>
          <ChevronRight size={17} />
        </summary>
        <FilterChips
          label="Срок платежей"
          value={period}
          options={periods.map((p) => ({
            ...p,
            count: due.filter((item) => matchesPeriod(item, p.value, day))
              .length,
          }))}
          onChange={(value) => {
            setPeriod(value);
            setLimit(6);
          }}
        />
        {due.length > 0 && (
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Поиск платежей"
              placeholder="Клиент, телефон или договор"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(6);
              }}
            />
          </label>
        )}
        {rows.length > 0 && (
          <p className="list-caption" role="status">
            Платежей: {rows.length}{" "}
            <span>{money(sum(rows.map((p) => p.remaining)))}</span>
          </p>
        )}
        {!rows.length && (
          <div className="pocket-empty compact-empty">
            <Clock size={26} />
            <h3>
              {due.length ? "Таких платежей нет" : "Платежей к получению нет"}
            </h3>
            <p>
              {due.length
                ? "Выберите другой срок или измените поиск."
                : "Здесь появятся сроки и суммы после оформления договора."}
            </p>
            {due.length > 0 && (
              <button
                className="btn btn-outline"
                onClick={() => {
                  setSearch("");
                  setPeriod("all");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}
        {rows.slice(0, limit).map((p) => (
          <Link
            key={p.id}
            className="merchant-row payment-row"
            href={`/crm/contracts/${p.contract_id}`}
          >
            <span className="avatar">{p.customer?.name[0] ?? "К"}</span>
            <div>
              <strong>{p.customer?.name ?? "Клиент"}</strong>
              <small>
                {p.product} · {p.contract.number}
              </small>
              <small className={p.overdue ? "danger-text" : ""}>
                {new Date(p.due_on + "T12:00:00").toLocaleDateString("ru-RU")} ·{" "}
                {p.overdue
                  ? "Просрочено"
                  : p.due_on === day
                    ? "Сегодня"
                    : "Ожидается"}
              </small>
            </div>
            <b>{money(p.remaining)}</b>
          </Link>
        ))}
        {rows.length > limit && (
          <button
            className="btn btn-outline full"
            onClick={() => setLimit((v) => v + 12)}
          >
            Показать ещё · {rows.length - limit}
          </button>
        )}
      </details>
      <section className="merchant-directory">
        <h2>Разделы магазина</h2>
        {canReview && (
          <Link href="/crm/applications">
            Все заявки <ChevronRight size={16} />
          </Link>
        )}
        <Link href="/crm/contracts">
          Договоры <ChevronRight size={16} />
        </Link>
        {canReview && (
          <Link href="/crm/customers">
            Клиенты <ChevronRight size={16} />
          </Link>
        )}
      </section>
    </div>
  );
}
