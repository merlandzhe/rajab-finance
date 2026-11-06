import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleOverview,
  matchesPeriod,
  matchesSearch,
  companyAccessCategory,
} from "../src/lib/cabinet-overview";
import type { State } from "../src/lib/types";

const day = "2026-10-29";
test("partial and unconfirmed payments retain the actual debt; foreign and unsigned schedules stay hidden", () => {
  const state = {
    contracts: [
      {
        id: "c",
        tenant_id: "a",
        status: "signed",
        customer_id: "u",
        number: "A-1",
      },
      { id: "draft", tenant_id: "a", status: "draft" },
    ],
    payment_schedules: [
      {
        id: "s1",
        tenant_id: "a",
        contract_id: "c",
        due_on: "2026-10-28",
        amount: "10001",
        sequence: 1,
      },
      {
        id: "s2",
        tenant_id: "a",
        contract_id: "c",
        due_on: "2026-11-29",
        amount: "20000",
        sequence: 2,
      },
      {
        id: "bad",
        tenant_id: "other",
        contract_id: "c",
        due_on: day,
        amount: "999",
        sequence: 1,
      },
      {
        id: "draft",
        tenant_id: "a",
        contract_id: "draft",
        due_on: day,
        amount: "999",
        sequence: 1,
      },
    ],
    payment_allocations: [{ schedule_id: "s1", amount: "4000" }],
    payment_claims: [{ contract_id: "c", amount: "6001", status: "pending" }],
    contract_items: [],
    customers: [],
  } as unknown as State;
  const rows = scheduleOverview(state, day);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].remaining, "6001");
  assert.equal(rows[0].paid, false);
  assert.equal(rows[0].overdue, true);
  state.payment_allocations.push({
    schedule_id: "s1",
    amount: "6001",
  } as State["payment_allocations"][number]);
  assert.equal(scheduleOverview(state, day)[0].paid, true);
  assert.equal(scheduleOverview(state, day)[0].overdue, false);
});

test("seven-day window crosses months and excludes paid and overdue instalments", () => {
  const row = (due_on: string, paid = false) => ({ due_on, paid });
  assert.ok(matchesPeriod(row(day), "today", day));
  assert.ok(matchesPeriod(row("2026-11-04"), "week", day));
  assert.equal(matchesPeriod(row("2026-11-05"), "week", day), false);
  assert.equal(matchesPeriod(row("2026-10-28"), "week", day), false);
  assert.equal(matchesPeriod(row(day, true), "today", day), false);
  assert.ok(matchesPeriod(row("2026-10-28"), "overdue", day));
  assert.ok(matchesPeriod(row(day, true), "paid", day));
});

test("subscription renewal queue excludes blocked or archived companies and includes exact expiry", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const c = {
    status: "active",
    archived: false,
    expires_at: null as string | null,
  };
  assert.equal(companyAccessCategory(c, now), "active");
  assert.equal(
    companyAccessCategory({ ...c, expires_at: "2026-11-05T00:00:00Z" }, now),
    "ending",
  );
  assert.equal(
    companyAccessCategory({ ...c, expires_at: "2026-10-29T00:00:00Z" }, now),
    "expired",
  );
  assert.equal(
    companyAccessCategory(
      { ...c, status: "blocked", expires_at: "2026-10-28T00:00:00Z" },
      now,
    ),
    "blocked",
  );
  assert.equal(
    companyAccessCategory({ ...c, archived: true }, now),
    "archived",
  );
});

test("directory search tolerates phone punctuation and Russian ё without matching arbitrary mixed digits", () => {
  assert.ok(matchesSearch("  СЕМЕН  ", ["Семён"]));
  assert.ok(matchesSearch("9991234567", ["+7 (999) 123-45-67"]));
  assert.ok(matchesSearch("", [null]));
  assert.equal(matchesSearch("клиент 999", ["+7 (999) 123-45-67"]), false);
});
