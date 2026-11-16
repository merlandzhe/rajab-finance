"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, FileText, Search } from "lucide-react";
import Decimal from "decimal.js";
import { FilterChips } from "./filter-chips";
import {
  contractPortfolio,
  matchesContractFilter,
  type ContractFilter,
} from "@/lib/portfolio";
import { matchesSearch } from "@/lib/cabinet-overview";
import { money, sum } from "@/lib/money";
import type { State } from "@/lib/types";

const filters: { value: ContractFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "overdue", label: "С просрочкой" },
  { value: "paid", label: "Погашены" },
];
const date = (value: string) =>
  new Date(value.slice(0, 10) + "T00:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function ContractList({ data }: { data: State }) {
  const params = useSearchParams();
  const router = useRouter();
  const filter: ContractFilter =
    filters.find((f) => f.value === params.get("status"))?.value ?? "all";
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(12);
  const portfolio = contractPortfolio(data);
  const rows = portfolio
    .filter(
      (r) =>
        matchesContractFilter(r, filter) &&
        matchesSearch(search, [
          r.customer?.name,
          r.customer?.phone,
          r.contract.number,
          r.product,
        ]),
    )
    .sort((a, b) => {
      if (filter === "overdue")
        return (a.next?.due_on ?? "").localeCompare(b.next?.due_on ?? "");
      return (
        b.contract.signed_on.localeCompare(a.contract.signed_on) ||
        b.contract.created_at.localeCompare(a.contract.created_at)
      );
    });
  function changeFilter(value: ContractFilter) {
    setLimit(12);
    router.replace("/crm/contracts?status=" + value, { scroll: false });
  }
  return (
    <section className="contract-workspace">
      <div className="page-heading">
        <div>
          <h1>Договоры</h1>
          <p>Остатки, сроки и история каждой рассрочки</p>
        </div>
      </div>
      <FilterChips
        label="Статус договоров"
        value={filter}
        onChange={changeFilter}
        options={filters.map((f) => ({
          ...f,
          count: portfolio.filter((r) => matchesContractFilter(r, f.value))
            .length,
        }))}
      />
      <label className="search-field mt">
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Поиск договоров"
          placeholder="Клиент, телефон, товар или договор"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(12);
          }}
        />
      </label>
      <div className="portfolio-totals" aria-live="polite">
        <span>
          Договоров <b>{rows.length}</b>
        </span>
        <span>
          Осталось получить <b>{money(sum(rows.map((r) => r.debt)))}</b>
        </span>
      </div>
      <div className="contract-card-grid">
        {rows.slice(0, limit).map((row) => (
          <Link
            className="card portfolio-card"
            key={row.contract.id}
            href={"/crm/contracts/" + row.contract.id}
            aria-label={
              "Договор " +
              row.contract.number +
              ", " +
              (row.customer?.name ?? "клиент")
            }
          >
            <div className="row between wrap">
              <span className="portfolio-number">{row.contract.number}</span>
              <span
                className={
                  "badge " +
                  (new Decimal(row.overdue).gt(0)
                    ? "danger"
                    : row.complete
                      ? ""
                      : "warn")
                }
              >
                {row.complete
                  ? "Погашен"
                  : new Decimal(row.overdue).gt(0)
                    ? "Просрочка"
                    : "Активен"}
              </span>
            </div>
            <h2>{row.customer?.name ?? "Клиент договора"}</h2>
            <p className="portfolio-product">{row.product}</p>
            <div className="portfolio-balance">
              <span>Осталось выплатить</span>
              <strong>{money(row.debt)}</strong>
            </div>
            <progress
              aria-label="Оплаченная часть договора"
              max={100}
              value={row.progress}
            />
            <p className="portfolio-progress-caption">
              Оплачено {money(row.paid)} из {money(row.contract.sale_price)}
            </p>
            <div className="portfolio-next">
              <div>
                {row.next ? (
                  <>
                    <span>
                      {row.next.overdue
                        ? "Просрочен с "
                        : "Следующий платёж · "}
                      {date(row.next.due_on)}
                    </span>
                    <strong>{money(row.next.remaining)}</strong>
                  </>
                ) : (
                  <span>
                    {row.complete
                      ? "Задолженности нет"
                      : "График пока недоступен"}
                  </span>
                )}
              </div>
              <ArrowUpRight size={19} aria-hidden="true" />
            </div>
            {row.pendingClaims > 0 && (
              <p className="portfolio-pending">
                Сообщений об оплате на проверке: {row.pendingClaims}
              </p>
            )}
          </Link>
        ))}
      </div>
      {!rows.length && (
        <div className="pocket-empty">
          <FileText size={30} />
          <h3>
            {portfolio.length ? "Договоры не найдены" : "Здесь будут договоры"}
          </h3>
          <p>
            {portfolio.length
              ? "Измените поиск или выбранный фильтр."
              : "Оформите договор из согласованной заявки клиента."}
          </p>
          {portfolio.length > 0 && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setSearch("");
                changeFilter("all");
              }}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
      {rows.length > limit && (
        <button
          className="btn btn-outline full mt"
          onClick={() => setLimit((v) => v + 12)}
        >
          Показать ещё · осталось {rows.length - limit}
        </button>
      )}
    </section>
  );
}
