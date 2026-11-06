import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractPortfolio,
  matchesContractFilter,
  paymentEntries,
  claimWasReversed,
} from "../src/lib/portfolio";
import { sum } from "../src/lib/money";
import type { State } from "../src/lib/types";
const base = { tenant_id: "a", created_at: "2026-10-29T09:00:00Z" };
function fixture() {
  return {
    contracts: [
      {
        ...base,
        id: "c",
        customer_id: "u",
        number: "H-1",
        status: "signed",
        signed_on: "2026-09-01",
        sale_price: "10001",
      },
      {
        ...base,
        id: "paid",
        customer_id: "v",
        number: "H-2",
        status: "closed",
        signed_on: "2026-09-01",
        sale_price: "900",
      },
    ],
    customers: [{ ...base, id: "u", name: "Семён", phone: "+79990000000" }],
    contract_items: [{ ...base, contract_id: "c", product_name: "Телефон" }],
    cash_accounts: [{ ...base, id: "account", name: "Расчётный счёт" }],
    payment_schedules: [
      {
        ...base,
        id: "s1",
        contract_id: "c",
        due_on: "2026-10-28",
        amount: "6001",
        sequence: 1,
      },
      {
        ...base,
        id: "s2",
        contract_id: "c",
        due_on: "2026-11-28",
        amount: "4000",
        sequence: 2,
      },
    ],
    payments: [
      {
        ...base,
        id: "p",
        contract_id: "c",
        amount: "4000",
        reversal_of: null,
        paid_on: "2026-10-29",
        cash_account_id: "account",
        reason: "",
      },
      {
        ...base,
        id: "paid-p",
        contract_id: "paid",
        amount: "900",
        reversal_of: null,
        paid_on: "2026-10-28",
        cash_account_id: "account",
        reason: "",
      },
    ],
    payment_allocations: [
      { ...base, payment_id: "p", schedule_id: "s1", amount: "4000" },
    ],
    payment_claims: [
      {
        ...base,
        id: "claim",
        contract_id: "c",
        amount: "2001",
        status: "pending",
        payment_id: null,
      },
    ],
  } as unknown as State;
}
test("portfolio uses confirmed sums, partial overdue and future debt; ignores pending reports", () => {
  const rows = contractPortfolio(fixture(), "2026-10-29");
  assert.equal(rows[0].debt, "6001");
  assert.equal(rows[0].overdue, "2001");
  assert.equal(rows[0].next?.remaining, "2001");
  assert.equal(rows[0].pendingClaims, 1);
  assert.ok(rows[0].progress > 39 && rows[0].progress < 40);
  for (const f of ["active", "paid", "overdue"] as const)
    assert.equal(rows.filter((r) => matchesContractFilter(r, f)).length, 1);
});
test("reversal restores debt and preserves both entries without double counting", () => {
  const data = fixture();
  data.payments.push({
    ...data.payments[0],
    id: "reverse",
    amount: "-4000",
    reversal_of: "p",
    reason: "Ошибка счёта",
    paid_on: "2026-10-30",
  });
  data.payment_allocations.push({
    ...data.payment_allocations[0],
    payment_id: "reverse",
    amount: "-4000",
  });
  const row = contractPortfolio(data, "2026-10-30")[0];
  assert.equal(row.paid, "0");
  assert.equal(row.progress, 0);
  assert.equal(row.debt, "10001");
  assert.equal(row.overdue, "6001");
  const entries = paymentEntries(data);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].payment.id, "reverse");
  assert.equal(
    entries.find((e) => e.payment.id === "p")?.reversal?.id,
    "reverse",
  );
  assert.equal(sum(entries.map((e) => e.payment.amount)), "900");
  const claim = {
    ...data.payment_claims[0],
    status: "confirmed" as const,
    payment_id: "p",
  };
  assert.equal(claimWasReversed(data, claim), true);
  assert.equal(claimWasReversed(data, { ...claim, tenant_id: "other" }), false);
});
test("history does not join receipts to another tenant's contract or account", () => {
  const data = fixture();
  data.payments.push({
    ...data.payments[0],
    id: "foreign",
    tenant_id: "other",
  });
  data.cash_accounts[0].tenant_id = "other";
  const rows = paymentEntries(data);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.payment.id === "p")?.account, "Счёт");
  data.payment_claims.push({
    ...data.payment_claims[0],
    id: "foreign-claim",
    tenant_id: "other",
  });
  assert.equal(contractPortfolio(data, "2026-10-29")[0].pendingClaims, 1);
});
