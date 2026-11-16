import Decimal from "decimal.js";
import { diff, sum, today } from "./money";
import type { State, Contract } from "./types";
export function contractPaid(s: State, id: string) {
  return sum(
    s.payments.filter((p) => p.contract_id === id).map((p) => p.amount),
  );
}
export function contractDebt(s: State, c: Contract) {
  return diff(c.sale_price, contractPaid(s, c.id));
}
export function scheduleRemaining(s: State, id: string, amount: string) {
  return diff(
    amount,
    sum(
      s.payment_allocations
        .filter((a) => a.schedule_id === id)
        .map((a) => a.amount),
    ),
  );
}
export function datePlus(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function metrics(
  s: State,
  contracts = s.contracts,
  payments = s.payments,
) {
  const ids = new Set(contracts.map((c) => c.id));
  const schedules = s.payment_schedules.filter((x) => ids.has(x.contract_id));
  const day = today();
  const due = (from: string, to: string) =>
    sum(
      schedules
        .filter((x) => x.due_on >= from && x.due_on <= to)
        .map((x) => scheduleRemaining(s, x.id, x.amount)),
    );
  return {
    active: contracts.filter((c) => new Decimal(contractDebt(s, c)).gt(0))
      .length,
    price: sum(contracts.map((c) => c.sale_price)),
    cost: sum(contracts.map((c) => c.cost)),
    profit: sum(contracts.map((c) => c.profit)),
    received: sum(
      payments.filter((p) => ids.has(p.contract_id)).map((p) => p.amount),
    ),
    debt: sum(contracts.map((c) => contractDebt(s, c))),
    overdue: due("0000-01-01", datePlus(day, -1)),
    today: due(day, day),
    week: due(day, datePlus(day, 7)),
    month: due(day, datePlus(day, 30)),
  };
}
