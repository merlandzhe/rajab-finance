"use client";
import { useState } from "react";
import { ArrowUpRight, CalendarDays, ShieldCheck } from "lucide-react";
import {
  calculate,
  cents,
  money,
  addMonths,
  today,
  type Pricing,
} from "@/lib/money";
import { Button } from "./ui/button";
export function Calculator({
  pricing,
  applyLink = true,
}: {
  pricing: Pricing;
  applyLink?: boolean;
}) {
  const terms =
    pricing.mode === "term"
      ? Object.keys(pricing.term_rates)
          .map(Number)
          .sort((a, b) => a - b)
      : [3, 6, 9, 12];
  const [cost, setCost] = useState("120000"),
    [down, setDown] = useState("20000"),
    [months, setMonths] = useState(terms.includes(6) ? 6 : terms[0]),
    [date, setDate] = useState(addMonths(today(), 1)),
    [custom, setCustom] = useState("18000"),
    [customKind, setCustomKind] = useState<"rubles" | "percent">("rubles"),
    [show, setShow] = useState(false);
  let result: ReturnType<typeof calculate> | undefined,
    error = "";
  try {
    result = calculate({
      cost: cents(cost),
      down: cents(down),
      months,
      firstDate: date,
      pricing,
      customKind,
      customValue: cents(custom),
    });
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <>
      <div className="card calculator">
        <div className="calc-fields">
          <div className="row between mb">
            <h3>Ваши условия</h3>
            <span className="badge neutral">
              Тарифы · версия {pricing.version}
            </span>
          </div>
          <label className="field">
            Стоимость товара, ₽
            <input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label className="field">
            Первоначальный взнос, ₽
            <input
              inputMode="decimal"
              value={down}
              onChange={(e) => setDown(e.target.value)}
            />
          </label>
          <div className="field">
            <span>Срок рассрочки</span>
            <div className="term-group">
              {terms.map((n) => (
                <button
                  className={"term " + (n === months ? "selected" : "")}
                  type="button"
                  key={n}
                  onClick={() => setMonths(n)}
                  aria-pressed={n === months}
                >
                  {n} мес.
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            Первый платёж
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {pricing.mode === "individual" && (
            <div className="grid2">
              <label className="field">
                Прибыль продавца
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </label>
              <label className="field">
                Способ расчёта
                <select
                  value={customKind}
                  onChange={(e) =>
                    setCustomKind(e.target.value as "rubles" | "percent")
                  }
                >
                  <option value="rubles">Рубли</option>
                  <option value="percent">% от себестоимости</option>
                </select>
              </label>
            </div>
          )}
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.8 }}>
            Это предварительный расчёт. Окончательная цена согласуется после
            приобретения товара продавцом.
          </p>
        </div>
        <div className="calc-result">
          <div>
            <p className="eyebrow">Фиксированная цена</p>
            <p className="big-price" style={{ marginTop: 16 }}>
              {result ? money(result.price, true) : "—"}
            </p>
            <p className="muted" style={{ fontSize: 12, marginTop: 5 }}>
              за весь товар, на весь срок
            </p>
          </div>
          {result ? (
            <>
              <div>
                <div className="calc-line">
                  <span className="muted">Себестоимость</span>
                  <span>{money(result.cost)}</span>
                </div>
                <div className="calc-line">
                  <span className="muted">Прибыль продавца</span>
                  <span>{money(result.profit)}</span>
                </div>
                <div className="calc-line">
                  <span className="muted">Первоначальный взнос</span>
                  <span>{money(result.down)}</span>
                </div>
                <div className="calc-line total">
                  <span>Платёж в месяц</span>
                  <strong>{money(result.each)}</strong>
                </div>
              </div>
              <div className="row" style={{ fontSize: 11, color: "#bfd7c8" }}>
                <ShieldCheck size={18} />
                <span>Цена не растёт из-за просрочки</span>
              </div>
              {applyLink && (
                <Button variant="gold" asChild>
                  <a href="#application">
                    Оставить тестовую заявку <ArrowUpRight size={16} />
                  </a>
                </Button>
              )}
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="row"
                style={{
                  background: "none",
                  border: 0,
                  color: "white",
                  fontSize: 11,
                  justifyContent: "center",
                }}
              >
                <CalendarDays size={15} />
                {show ? "Скрыть график" : "Посмотреть график платежей"}
              </button>
            </>
          ) : (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
      {show && result && (
        <div className="card schedule">
          <div className="card-heading">
            <h3>График платежей</h3>
            <span className="muted" style={{ fontSize: 11 }}>
              Остаток: {money(result.remaining)}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Платёж</th>
                  <th>Дата</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.sequence}>
                    <td>№ {row.sequence}</td>
                    <td>
                      {new Date(row.due_on + "T00:00:00").toLocaleDateString(
                        "ru-RU",
                      )}
                    </td>
                    <td>{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pad muted" style={{ fontSize: 11 }}>
            Первоначальный взнос учитывается отдельно. Последний платёж
            корректирует округление до копейки.
          </div>
        </div>
      )}
    </>
  );
}
