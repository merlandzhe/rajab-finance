import Decimal from "decimal.js";
import { datePlus, scheduleRemaining } from "./metrics";
import { today } from "./money";
import type { State } from "./types";

export type PaymentPeriod = "all" | "today" | "week" | "overdue" | "paid";

// Uses the server-authorized state and confirmed ledger allocations.
// Pending payment reports never mark an instalment paid.
export function scheduleOverview(data: State, day = today()) {
  return data.payment_schedules
    .flatMap((schedule) => {
      const contract = data.contracts.find(
        (c) =>
          c.id === schedule.contract_id && c.tenant_id === schedule.tenant_id,
      );
      if (
        !contract ||
        !["signed", "transferred", "closed"].includes(contract.status)
      )
        return [];
      const remaining = scheduleRemaining(data, schedule.id, schedule.amount);
      const paid = new Decimal(remaining).lte(0);
      return [
        {
          ...schedule,
          contract,
          remaining,
          paid,
          overdue: !paid && schedule.due_on < day,
          customer: data.customers.find(
            (c) =>
              c.id === contract.customer_id &&
              c.tenant_id === contract.tenant_id,
          ),
          product:
            data.contract_items.find(
              (i) =>
                i.contract_id === contract.id &&
                i.tenant_id === contract.tenant_id,
            )?.product_name ?? contract.number,
        },
      ];
    })
    .sort(
      (a, b) => a.due_on.localeCompare(b.due_on) || a.sequence - b.sequence,
    );
}

export function matchesPeriod(
  item: { due_on: string; paid: boolean },
  period: PaymentPeriod,
  day = today(),
) {
  if (period === "paid") return item.paid;
  if (item.paid) return false;
  if (period === "today") return item.due_on === day;
  if (period === "week")
    return item.due_on >= day && item.due_on <= datePlus(day, 6);
  if (period === "overdue") return item.due_on < day;
  return true;
}

export function matchesSearch(
  query: string,
  values: (string | null | undefined)[],
) {
  const q = query.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  if (!q) return true;
  const text = values
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е");
  if (text.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return (
    /^[+\d\s()-]+$/.test(q) &&
    digits.length >= 3 &&
    values.some((v) => v?.replace(/\D/g, "").includes(digits))
  );
}

export function companyAccessCategory(
  company: { status: string; expires_at: string | null; archived: boolean },
  now = Date.now(),
) {
  if (company.archived) return "archived";
  if (company.status === "blocked") return "blocked";
  if (company.status !== "active") return "pending";
  if (!company.expires_at) return "active";
  const expires = new Date(company.expires_at).getTime();
  if (!Number.isFinite(expires) || expires <= now) return "expired";
  return expires <= now + 7 * 86400000 ? "ending" : "active";
}
