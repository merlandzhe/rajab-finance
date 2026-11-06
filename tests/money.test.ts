import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  cents,
  calculate,
  addMonths,
  DEMO_PRICING,
  sum,
} from "../src/lib/money";
const base = {
  cost: "10000000",
  down: "2000000",
  months: 6,
  firstDate: "2027-01-31",
};
test("fixed markup is one-time on cost", () => {
  const q = calculate({
    ...base,
    pricing: { ...DEMO_PRICING, mode: "fixed", fixed_bps: 1250 },
  });
  assert.equal(q.profit, "1250000");
  assert.equal(q.price, "11250000");
  assert.equal(sum(q.schedule.map((s) => s.amount)), q.remaining);
});
test("term grid selects exact term; unsupported term rejected", () => {
  const q = calculate({ ...base, pricing: DEMO_PRICING });
  assert.equal(q.profit, "1200000");
  assert.throws(
    () => calculate({ ...base, months: 5, pricing: DEMO_PRICING }),
    /тариф/,
  );
});
test("individual profit in rubles and percent", () => {
  assert.equal(
    calculate({
      ...base,
      pricing: { ...DEMO_PRICING, mode: "individual" },
      customKind: "rubles",
      customValue: "54321",
    }).profit,
    "54321",
  );
  assert.equal(
    calculate({
      ...base,
      pricing: { ...DEMO_PRICING, mode: "individual" },
      customKind: "percent",
      customValue: "1735",
    }).profit,
    "1735000",
  );
});
test("rounding differences go to last payment", () => {
  const q = calculate({
    ...base,
    cost: "10000",
    down: "0",
    months: 3,
    pricing: { ...DEMO_PRICING, mode: "fixed", fixed_bps: 0 },
  });
  assert.deepEqual(
    q.schedule.map((x) => x.amount),
    ["3333", "3333", "3334"],
  );
});
test("money input rejects excess decimals and scientific notation", () => {
  assert.equal(cents("12,34"), "1234");
  for (const s of ["1.001", "-1", "1e3", "Infinity", "NaN", ""])
    assert.throws(() => cents(s));
});
test("month-end dates clamp to month but preserve anchor", () => {
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2028-01-31", 2), "2028-03-31");
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
});
test("overpayment, zero cost, invalid dates and terms rejected", () => {
  for (const patch of [
    { cost: "0" },
    { down: "999999999" },
    { months: 0 },
    { months: 37 },
    { firstDate: "2027-02-30" },
  ])
    assert.throws(() =>
      calculate({ ...base, ...patch, pricing: DEMO_PRICING }),
    );
});
test("1000 deterministic combinations reconcile to exact kopeck", () => {
  for (let i = 1; i <= 1000; i++) {
    const q = calculate({
      ...base,
      cost: String(i * 997 + 1),
      down: String(i * 2),
      months: (i % 36) + 1,
      pricing: { ...DEMO_PRICING, mode: "fixed", fixed_bps: i % 5000 },
    });
    assert.equal(sum(q.schedule.map((s) => s.amount)), q.remaining);
    assert.equal(new Decimal(q.remaining).plus(q.down).toFixed(0), q.price);
  }
});
