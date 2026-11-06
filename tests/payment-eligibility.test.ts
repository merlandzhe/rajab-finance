import { test } from "node:test";
import assert from "node:assert/strict";
import { payableContracts } from "../src/lib/payment-eligibility";
import type { Contract, Schedule } from "../src/lib/types";

const contract = { id: "c", tenant_id: "shop", status: "signed" } as Contract;
const schedule = { contract_id: "c", tenant_id: "shop" } as Schedule;
test("payment details require a concluded contract and its own schedule", () => {
  for (const status of ["draft", "review", "approved", "cancelled", "closed"]) {
    assert.equal(
      payableContracts(
        { contracts: [{ ...contract, status }], payment_schedules: [schedule] },
        "shop",
      ).length,
      0,
    );
  }
  assert.equal(
    payableContracts({ contracts: [], payment_schedules: [] }, "shop").length,
    0,
  );
  assert.equal(
    payableContracts({ contracts: [contract], payment_schedules: [] }, "shop")
      .length,
    0,
  );
  assert.equal(
    payableContracts(
      {
        contracts: [contract],
        payment_schedules: [{ ...schedule, tenant_id: "other" }],
      },
      "shop",
    ).length,
    0,
  );
  assert.equal(
    payableContracts(
      { contracts: [contract], payment_schedules: [schedule] },
      "other",
    ).length,
    0,
  );
  for (const status of ["signed", "transferred"]) {
    assert.equal(
      payableContracts(
        { contracts: [{ ...contract, status }], payment_schedules: [schedule] },
        "shop",
      ).length,
      1,
    );
  }
});
