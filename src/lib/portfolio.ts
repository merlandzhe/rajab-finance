import Decimal from "decimal.js";
import { scheduleOverview } from "./cabinet-overview";
import { contractDebt, contractPaid } from "./metrics";
import { sum, today } from "./money";
import type { State } from "./types";

export type ContractFilter = "all" | "active" | "overdue" | "paid";

// Presentation only: the confirmed ledger remains the source of truth.
export function contractPortfolio(data: State, day = today()) {
  const schedule = scheduleOverview(data, day);
  return data.contracts.map((contract) => {
    const rows = schedule.filter(
      (s) =>
        s.contract_id === contract.id && s.tenant_id === contract.tenant_id,
    );
    const paid = contractPaid(data, contract.id);
    const debt = contractDebt(data, contract);
    const overdue = sum(rows.filter((s) => s.overdue).map((s) => s.remaining));
    const complete = new Decimal(debt).lte(0);
    const progress = new Decimal(contract.sale_price).gt(0)
      ? Decimal.max(
          0,
          Decimal.min(100, new Decimal(paid).div(contract.sale_price).mul(100)),
        ).toNumber()
      : 0;
    return {
      contract,
      customer: data.customers.find(
        (c) =>
          c.id === contract.customer_id && c.tenant_id === contract.tenant_id,
      ),
      product:
        data.contract_items.find(
          (i) =>
            i.contract_id === contract.id && i.tenant_id === contract.tenant_id,
        )?.product_name ?? "Рассрочка",
      paid,
      debt,
      overdue,
      complete,
      progress,
      next: rows.find((s) => !s.paid),
      pendingClaims: data.payment_claims.filter(
        (c) =>
          c.contract_id === contract.id &&
          c.tenant_id === contract.tenant_id &&
          c.status === "pending",
      ).length,
    };
  });
}

export function matchesContractFilter(
  row: ReturnType<typeof contractPortfolio>[number],
  filter: ContractFilter,
) {
  if (filter === "paid") return row.complete;
  if (filter === "overdue") return new Decimal(row.overdue).gt(0);
  if (filter === "active") return !row.complete;
  return true;
}

export function paymentEntries(data: State) {
  return data.payments
    .flatMap((payment) => {
      const contract = data.contracts.find(
        (c) =>
          c.id === payment.contract_id && c.tenant_id === payment.tenant_id,
      );
      if (!contract) return [];
      const reversal = data.payments.find(
        (p) =>
          p.reversal_of === payment.id && p.tenant_id === payment.tenant_id,
      );
      return [
        {
          payment,
          contract,
          reversal,
          customer: data.customers.find(
            (c) =>
              c.id === contract.customer_id &&
              c.tenant_id === contract.tenant_id,
          ),
          account:
            data.cash_accounts.find(
              (a) =>
                a.id === payment.cash_account_id &&
                a.tenant_id === payment.tenant_id,
            )?.name ?? "Счёт",
          product:
            data.contract_items.find(
              (i) =>
                i.contract_id === contract.id &&
                i.tenant_id === contract.tenant_id,
            )?.product_name ?? "",
        },
      ];
    })
    .sort(
      (a, b) =>
        b.payment.paid_on.localeCompare(a.payment.paid_on) ||
        b.payment.created_at.localeCompare(a.payment.created_at) ||
        b.payment.id.localeCompare(a.payment.id),
    );
}

export function claimWasReversed(
  data: State,
  claim: State["payment_claims"][number],
) {
  return (
    claim.status === "confirmed" &&
    !!claim.payment_id &&
    data.payments.some(
      (p) =>
        p.reversal_of === claim.payment_id && p.tenant_id === claim.tenant_id,
    )
  );
}
