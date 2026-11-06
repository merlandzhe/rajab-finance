import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { shim, seed } from "./fixtures/seed";
import { TEST_USERS, TENANT, OTHER_TENANT } from "./fixtures/ids";
import { today, addMonths, calculate, TEST_PRICING } from "../src/lib/money";
import { TEST_PRICING } from "./fixtures/pricing";
import type { State } from "../src/lib/types";
let db: PGlite;
const owner = TEST_USERS.owner.id,
  other = TEST_USERS.other.id,
  manager = TEST_USERS.manager.id,
  cashier = TEST_USERS.cashier.id,
  client = TEST_USERS.client.id;
async function as<T>(user: string | null, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role " + (user ? "authenticated" : "anon"));
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    return tx.query<T>(sql, args);
  });
}
async function cmd(
  user: string,
  action: string,
  payload: unknown,
  key = randomUUID(),
) {
  return (
    await as<{ value: { id: string; ok: boolean } }>(
      user,
      "select app_command($1,$2::jsonb,$3) as value",
      [action, JSON.stringify(payload), key],
    )
  ).rows[0].value;
}
async function state(user: string) {
  return (await as<{ s: State }>(user, "select app_state() as s")).rows[0].s;
}
async function portal(
  user: string,
  action: string,
  payload: unknown,
  key = randomUUID(),
) {
  return (
    await as<{ value: { id: string; ok: boolean } }>(
      user,
      "select portal_command($1,$2::jsonb,$3) as value",
      [action, JSON.stringify(payload), key],
    )
  ).rows[0].value;
}
before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(shim);
  for (const f of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await seed(db);
});
test("client application is owned by caller, visible to owner, and isolated from other organizations", async () => {
  const payload = {
    product_name: "Ноутбук клиента",
    product_url: "https://example.invalid/item",
    estimated_cost: "1000000",
    down_payment: "0",
    months: 6,
    notes: "Тест",
  };
  const key = randomUUID();
  const a = await portal(client, "portal.application", payload, key);
  assert.equal(
    (await portal(client, "portal.application", payload, key)).id,
    a.id,
  );
  const own = await state(client);
  const row = own.applications.find((x) => x.id === a.id)!;
  assert.equal(row.customer_id, own.customers[0].id);
  assert.ok((await state(owner)).applications.some((x) => x.id === a.id));
  assert.ok(!(await state(other)).applications.some((x) => x.id === a.id));
  await assert.rejects(portal(manager, "portal.application", payload));
  await assert.rejects(
    portal(client, "portal.application", { ...payload, months: 0 }),
  );
  await assert.rejects(
    portal(client, "portal.application", {
      ...payload,
      down_payment: "99999999999",
    }),
  );
});
test("payment claims do not change debt; owner confirmation is atomic and idempotent", async () => {
  const before = await state(client);
  const c = before.contracts.find((x) => x.status !== "closed")!;
  const payload = {
    contract_id: c.id,
    amount: "100",
    paid_on: today(),
    method: "sbp",
  };
  const key = randomUUID();
  const claim = await portal(client, "portal.claim", payload, key);
  assert.equal(
    (await portal(client, "portal.claim", payload, key)).id,
    claim.id,
  );
  assert.equal((await state(client)).payments.length, before.payments.length);
  await assert.rejects(portal(client, "portal.claim", payload));
  await assert.rejects(
    portal(client, "portal.confirm", {
      id: claim.id,
      cash_account_id: randomUUID(),
    }),
  );
  await assert.rejects(
    portal(manager, "portal.reject", { id: claim.id, reason: "Проверка" }),
  );
  await assert.rejects(
    portal(other, "portal.reject", { id: claim.id, reason: "Проверка" }),
  );
  const confirmation = {
    id: claim.id,
    cash_account_id: (await state(owner)).cash_accounts[0].id,
  };
  const confirmKey = randomUUID();
  await portal(owner, "portal.confirm", confirmation, confirmKey);
  await portal(owner, "portal.confirm", confirmation, confirmKey);
  const after = await state(client);
  assert.equal(after.payments.length, before.payments.length + 1);
  assert.equal(
    after.payment_claims.find((x) => x.id === claim.id)?.status,
    "confirmed",
  );
  await assert.rejects(portal(owner, "portal.confirm", confirmation));
  assert.ok(
    !(await state(other)).payment_claims.some((x) => x.id === claim.id),
  );
  await assert.rejects(
    as(client, "update payment_claims set status='confirmed' where id=$1", [
      claim.id,
    ]),
  );
});
test("rejection preserves debt, permits resubmission, and forbids foreign contracts", async () => {
  const before = await state(client);
  const c = before.contracts[0];
  const payload = {
    contract_id: c.id,
    amount: "100",
    paid_on: today(),
    method: "cash",
  };
  const claim = await portal(client, "portal.claim", payload);
  await portal(owner, "portal.reject", {
    id: claim.id,
    reason: "Наличные не получены",
  });
  assert.equal((await state(client)).payments.length, before.payments.length);
  assert.equal(
    (await state(client)).payment_claims.find((x) => x.id === claim.id)?.reason,
    "Наличные не получены",
  );
  const second = await portal(client, "portal.claim", payload);
  await portal(owner, "portal.reject", {
    id: second.id,
    reason: "Повторная проверка",
  });
  const foreign = (await state(owner)).contracts.find(
    (x) => !before.contracts.some((y) => y.id === x.id),
  )!;
  await assert.rejects(
    portal(client, "portal.claim", { ...payload, contract_id: foreign.id }),
  );
  await assert.rejects(
    portal(client, "portal.claim", { ...payload, amount: "100000000000" }),
  );
});
after(async () => {
  await db.close();
});
test("all exposed business tables have RLS enabled", async () => {
  const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'",
  );
  for (const name of [
    "organizations",
    "organization_members",
    "profiles",
    "customers",
    "applications",
    "suppliers",
    "products",
    "purchases",
    "contracts",
    "contract_items",
    "contract_versions",
    "payment_schedules",
    "payments",
    "payment_allocations",
    "cash_accounts",
    "cash_transactions",
    "documents",
    "document_templates",
    "notifications",
    "audit_logs",
    "organization_settings",
    "subscription_plans",
    "subscriptions",
    "operations",
    "payment_claims",
  ])
    assert.ok(
      rows.rows.some((r) => r.relname === name),
      name,
    );
  assert.ok(rows.rows.every((r) => r.relrowsecurity));
});
test("tenant A and B never read each other; unknown JWT has no membership", async () => {
  const a = await state(owner),
    b = await state(other),
    unknown = await state(randomUUID());
  assert.equal(a.customers.length, 6);
  assert.equal(b.customers.length, 1);
  assert.equal(b.contracts.length, 0);
  assert.ok(a.customers.every((c) => c.tenant_id === TENANT));
  assert.ok(b.customers.every((c) => c.tenant_id === OTHER_TENANT));
  assert.equal(unknown.customers.length, 0);
});
test("client can read only own contract, schedules, payments and snapshot", async () => {
  const s = await state(client);
  assert.equal(s.contracts.length, 1);
  assert.equal(s.customers.length, 1);
  assert.ok(s.applications.length > 0);
  assert.ok(s.applications.every((a) => a.customer_id === s.customers[0].id));
  assert.equal(s.cash_accounts.length, 0);
  assert.equal(s.settings.length, 0);
  assert.ok(
    s.payment_schedules.every((x) => x.contract_id === s.contracts[0].id),
  );
  assert.ok(s.payments.every((x) => x.contract_id === s.contracts[0].id));
  await assert.rejects(
    cmd(client, "customer.create", {
      name: "Forbidden",
      phone: "+7 000 000 00 00",
    }),
    /прав/,
  );
});
test("platform admin sees metadata, no confidential tenant rows", async () => {
  const s = await state(TEST_USERS.platform.id);
  assert.equal(s.organizations.length, 2);
  for (const key of [
    "customers",
    "contracts",
    "payments",
    "applications",
    "documents",
  ] as const)
    assert.equal(s[key].length, 0);
});
test("anonymous cannot read business tables or call mutations", async () => {
  await assert.rejects(
    as(null, "select * from customers"),
    /permission denied/,
  );
  await assert.rejects(
    as(null, "select app_command('customer.create','{}',gen_random_uuid())"),
    /permission denied/,
  );
});
test("direct table writes and role self-promotion are denied", async () => {
  await assert.rejects(
    as(
      owner,
      "insert into customers(tenant_id,name,phone) values($1,'x','1234567')",
      [OTHER_TENANT],
    ),
    /permission denied/,
  );
  await assert.rejects(
    as(
      manager,
      "update organization_members set role='owner' where user_id=$1",
      [manager],
    ),
    /permission denied/,
  );
});
test("cross-tenant entity references are rejected by RPC and composite FK", async () => {
  const s = await state(owner);
  await assert.rejects(
    cmd(other, "application.create", {
      customer_id: s.customers[0].id,
      product_name: "Тест",
      supplier: "Тест",
      estimated_cost: "1000",
      down_payment: "0",
      months: 6,
    }),
    /Клиент не найден/,
  );
  await assert.rejects(
    db.query(
      "insert into applications(tenant_id,customer_id,product_name,estimated_cost,months) values($1,$2,'bad',100,6)",
      [OTHER_TENANT, s.customers[0].id],
    ),
    /foreign key/,
  );
});
test("manager cannot change pricing or post payments; cashier cannot change applications", async () => {
  await assert.rejects(cmd(manager, "settings.update", {}), /владельца/);
  await assert.rejects(cmd(manager, "payment.record", {}), /кассира/);
  await assert.rejects(cmd(cashier, "application.create", {}), /менеджера/);
});
test("contract creation before purchase and forged purchase document are blocked", async () => {
  const s = await state(owner);
  const a = s.applications.find((x) => x.status === "awaiting_purchase")!;
  await assert.rejects(cmd(owner, "contract.create", { id: a.id }), /закупка/);
  await assert.rejects(
    cmd(owner, "purchase.record", {
      id: a.id,
      document_id: randomUUID(),
      cost: "100000",
      supplier: "Тест",
      purchased_on: today(),
      ownership_confirmed: true,
    }),
    /документ/,
  );
  await assert.rejects(
    cmd(owner, "document.register", {
      application_id: a.id,
      storage_path: `${TENANT}/${a.id}/fake.pdf`,
    }),
    /файл/,
  );
});
test("partial payment, exact retry, conflicting retry and overpayment", async () => {
  let s = await state(owner);
  const c = s.contracts[0];
  const a = s.cash_accounts[0];
  const key = randomUUID();
  const payload = {
    contract_id: c.id,
    cash_account_id: a.id,
    amount: "12345",
    paid_on: today(),
  };
  const first = await cmd(owner, "payment.record", payload, key);
  assert.deepEqual(await cmd(owner, "payment.record", payload, key), first);
  s = await state(owner);
  assert.equal(s.payments.filter((p) => p.operation_key === key).length, 1);
  assert.equal(
    s.payment_allocations
      .filter((x) => x.payment_id === first.id)
      .reduce((n, x) => n + BigInt(x.amount), 0n),
    12345n,
  );
  await assert.rejects(
    cmd(owner, "payment.record", { ...payload, amount: "999" }, key),
    /других данных/,
  );
  await assert.rejects(
    cmd(owner, "payment.record", { ...payload, amount: "99999999999" }),
    /остаток/,
  );
});
test("reversal preserves original, restores allocations, requires reason and prevents repeat", async () => {
  let s = await state(owner);
  const p = s.payments.find(
    (p) => p.amount === "12345" || String(p.amount) === "12345",
  )!;
  await assert.rejects(
    cmd(owner, "payment.reverse", { id: p.id, reason: "x" }),
    /причину/,
  );
  const reversed = await cmd(owner, "payment.reverse", {
    id: p.id,
    reason: "Исправление ошибочной записи",
  });
  s = await state(owner);
  assert.ok(s.payments.some((x) => x.id === p.id));
  assert.equal(
    String(s.payments.find((x) => x.id === reversed.id)!.amount),
    "-12345",
  );
  await assert.rejects(
    cmd(owner, "payment.reverse", { id: p.id, reason: "Повторная отмена" }),
    /уже отменён/,
  );
});
test("cash transfers are balanced, atomic and cannot cross tenants or go negative", async () => {
  const s = await state(owner),
    a = s.cash_accounts[0],
    b = s.cash_accounts[1];
  const before = (
    await db.query<{ n: string }>(
      "select sum(amount)::text as n from cash_transactions where tenant_id=$1",
      [TENANT],
    )
  ).rows[0].n;
  const key = randomUUID();
  await cmd(
    owner,
    "cash.move",
    {
      cash_account_id: a.id,
      destination_id: b.id,
      kind: "transfer",
      amount: "1234",
      description: "Тестовый перевод",
    },
    key,
  );
  const records = await db.query<{ amount: string }>(
    "select amount::text from cash_transactions where operation_key=$1",
    [key],
  );
  assert.equal(records.rows.length, 2);
  assert.equal(
    records.rows.reduce((n, x) => n + BigInt(x.amount), 0n),
    0n,
  );
  assert.equal(
    (
      await db.query<{ n: string }>(
        "select sum(amount)::text as n from cash_transactions where tenant_id=$1",
        [TENANT],
      )
    ).rows[0].n,
    before,
  );
  await assert.rejects(
    cmd(owner, "cash.move", {
      cash_account_id: a.id,
      kind: "expense",
      amount: "99999999999",
      description: "Невозможный расход",
    }),
    /Недостаточно/,
  );
  const bState = await state(other);
  await assert.rejects(
    cmd(owner, "cash.move", {
      cash_account_id: a.id,
      destination_id: bState.cash_accounts[0].id,
      kind: "transfer",
      amount: "100",
      description: "Чужая касса",
    }),
    /другую кассу/,
  );
});
test("settings create immutable versions without repricing signed deals", async () => {
  const s = await state(owner);
  const snapshot = JSON.stringify(s.contract_versions);
  await cmd(owner, "settings.update", {
    mode: "fixed",
    fixed_bps: 3333,
    term_rates: { 6: 1200 },
    prevent_negative_cash: true,
  });
  const next = await state(owner);
  assert.equal(next.settings[0].version, 2);
  assert.equal(JSON.stringify(next.contract_versions), snapshot);
  assert.deepEqual(
    next.contracts.map((c) => c.sale_price),
    s.contracts.map((c) => c.sale_price),
  );
  await assert.rejects(
    db.query("update organization_settings set fixed_bps=1 where id=$1", [
      next.settings[0].id,
    ]),
    /неизменяема/,
  );
  await assert.rejects(
    db.query(
      "update contracts set profit=profit+1,sale_price=sale_price+1 where id=$1",
      [s.contracts[0].id],
    ),
    /неизменяемы/,
  );
});
test("SQL and Decimal calculations match for all pricing modes", async () => {
  for (const [mode, kind, value] of [
    ["fixed", null, null],
    ["term", null, null],
    ["individual", "rubles", "98765"],
    ["individual", "percent", "1735"],
  ] as const) {
    const cost = "9999999";
    const sql = await db.query<{ p: string }>(
      "select private.profit($1,$2,$3,$4,$5::jsonb,$6,$7)::text as p",
      [
        cost,
        6,
        mode,
        1250,
        JSON.stringify(TEST_PRICING.term_rates),
        kind,
        value,
      ],
    );
    const js = calculate({
      cost,
      down: "123",
      months: 6,
      firstDate: "2027-01-31",
      pricing: { ...TEST_PRICING, mode, fixed_bps: 1250 },
      customKind: kind ?? undefined,
      customValue: value ?? undefined,
    });
    assert.equal(sql.rows[0].p, js.profit);
  }
});
test("full lifecycle: purchase -> agreement -> contract -> transfer -> early settlement -> closed", async () => {
  const s = await state(owner);
  const customer = s.customers[0].id;
  const a = await cmd(manager, "application.create", {
    customer_id: customer,
    product_name: "Демо ноутбук полного цикла",
    supplier: "Тест",
    estimated_cost: "10000001",
    down_payment: "1000000",
    months: 6,
  });
  await cmd(manager, "application.transition", {
    id: a.id,
    status: "approved",
  });
  await cmd(manager, "application.transition", {
    id: a.id,
    status: "awaiting_purchase",
  });
  const docId = randomUUID(),
    docPath = `${TENANT}/${a.id}/${docId}.pdf`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('deal-documents',$1)",
    [docPath],
  );
  const doc = await cmd(manager, "document.register", {
    application_id: a.id,
    kind: "purchase_receipt",
    name: "Тест.pdf",
    storage_path: docPath,
    mime_type: "application/pdf",
    size_bytes: 100,
    sha256: "a".repeat(64),
  });
  await assert.rejects(
    cmd(manager, "purchase.record", {
      id: a.id,
      supplier: "Тест",
      cost: "10000001",
      purchased_on: today(),
      document_id: doc.id,
      ownership_confirmed: false,
    }),
    /право собственности/,
  );
  await cmd(manager, "purchase.record", {
    id: a.id,
    supplier: "Тест",
    cost: "10000001",
    purchased_on: today(),
    document_id: doc.id,
    ownership_confirmed: true,
  });
  await assert.rejects(
    cmd(manager, "quote.confirm", {
      id: a.id,
      months: 6,
      down_payment: "1000000",
      first_payment_on: addMonths(today(), 1),
      agreed: true,
      custom_kind: "rubles",
      custom_value: "123",
    }),
    /владелец/,
  );
  await cmd(owner, "quote.confirm", {
    id: a.id,
    months: 6,
    down_payment: "1000000",
    first_payment_on: addMonths(today(), 1),
    agreed: true,
    custom_kind: "rubles",
    custom_value: "98765",
  });
  const c = await cmd(owner, "contract.create", { id: a.id });
  let st = await state(owner);
  const contract = st.contracts.find((x) => x.id === c.id)!;
  assert.equal(String(contract.sale_price), "10098766");
  const total = st.payment_schedules
    .filter((x) => x.contract_id === c.id)
    .reduce((n, x) => n + BigInt(x.amount), 0n);
  assert.equal(total, 10098766n);
  assert.equal(st.payments.filter((p) => p.contract_id === c.id).length, 0);
  await cmd(manager, "contract.transfer", {
    id: c.id,
    transferred_on: today(),
    reference: "Демонстрационный акт 01",
  });
  await cmd(cashier, "payment.record", {
    contract_id: c.id,
    cash_account_id: s.cash_accounts[0].id,
    amount: "10098766",
    paid_on: today(),
  });
  st = await state(owner);
  assert.equal(st.contracts.find((x) => x.id === c.id)!.status, "closed");
  assert.equal(
    st.payments
      .filter((x) => x.contract_id === c.id)
      .reduce((n, x) => n + BigInt(x.amount), 0n),
    10098766n,
  );
});
test("duplicate concurrent payment requests produce one ledger entry", async () => {
  const s = await state(owner);
  const c = s.contracts.find((x) => x.status !== "closed")!;
  const key = randomUUID();
  const payload = {
    contract_id: c.id,
    cash_account_id: s.cash_accounts[0].id,
    amount: "99",
    paid_on: today(),
  };
  const [a, b] = await Promise.all([
    cmd(owner, "payment.record", payload, key),
    cmd(owner, "payment.record", payload, key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (await state(owner)).payments.filter((p) => p.operation_key === key).length,
    1,
  );
});
test("notifications worker functions cannot be called by a customer or employee", async () => {
  await assert.rejects(
    as(owner, "select * from claim_notifications($1)", [TENANT]),
    /permission denied/,
  );
  await assert.rejects(
    as(client, "select queue_reminders($1)", [TENANT]),
    /permission denied/,
  );
});
test("rate limit is persistent across requests", async () => {
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select consume_rate_limit('test',3,60) as ok",
        )
      ).rows[0].ok,
      true,
    );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select consume_rate_limit('test',3,60) as ok",
      )
    ).rows[0].ok,
    false,
  );
});

test("dashboard reconciles prices, receipts, debt and contractual profit", async () => {
  const { metrics } = await import("../src/lib/metrics");
  const s = await state(owner);
  const m = metrics(s);
  const price = s.contracts.reduce((n, c) => n + BigInt(c.sale_price), 0n);
  const receipts = s.payments.reduce((n, p) => n + BigInt(p.amount), 0n);
  const profit = s.contracts.reduce((n, c) => n + BigInt(c.profit), 0n);
  assert.equal(m.price, price.toString());
  assert.equal(m.received, receipts.toString());
  assert.equal(m.debt, (price - receipts).toString());
  assert.equal(m.profit, profit.toString());
  assert.notEqual(m.profit, m.received);
});

async function telegramExchange(
  id: number,
  digest: string,
  invite: string | null = null,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return (
      await tx.query<{ id: string }>(
        "select telegram_exchange($1,$2,$3) as id",
        [id, digest, invite],
      )
    ).rows[0].id;
  });
}
test("Telegram invitations restrict tenant, client account and staff role; private credentials are inaccessible", async () => {
  const customer = (await state(client)).customers[0].id;
  for (const user of [null, manager, cashier, other, client]) {
    await assert.rejects(
      as(user, "select telegram_invite($1,$2)", ["a".repeat(64), customer]),
    );
  }
  for (const user of [owner, client, null]) {
    await assert.rejects(
      as(user, "select * from private.telegram_accounts"),
      /permission denied/,
    );
    await assert.rejects(
      as(user, "select * from private.telegram_invites"),
      /permission denied/,
    );
    await assert.rejects(
      as(user, "select telegram_exchange(123,$1,null)", ["a".repeat(64)]),
      /permission denied/,
    );
  }
  await as(owner, "select telegram_invite($1,$2)", ["a".repeat(64), customer]);
  await as(owner, "select telegram_invite($1,$2)", ["b".repeat(64), customer]);
  await assert.rejects(
    telegramExchange(123, "1".repeat(64), "a".repeat(64)),
    /INVITE_INVALID/,
  );
  await as(owner, "select telegram_cancel_invite($1)", [customer]);
  await assert.rejects(
    telegramExchange(123, "1".repeat(64), "b".repeat(64)),
    /INVITE_INVALID/,
  );
  await assert.rejects(
    telegramExchange(123, "1".repeat(64)),
    /INVITE_REQUIRED/,
  );
});
test("Telegram link and replay checks are atomic; invites cannot replace a bound identity", async () => {
  const customer = (await state(client)).customers[0].id;
  const token = "c".repeat(64);
  await as(owner, "select telegram_invite($1,$2)", [token, customer]);
  await db.query(
    "update organization_members set role='manager' where user_id=$1",
    [client],
  );
  await assert.rejects(
    telegramExchange(123, "2".repeat(64), token),
    /FORBIDDEN/,
  );
  await db.query(
    "update organization_members set role='client' where user_id=$1",
    [client],
  );
  assert.equal(await telegramExchange(123, "2".repeat(64), token), client);
  await assert.rejects(telegramExchange(123, "2".repeat(64)), /REPLAY/);
  await assert.rejects(
    telegramExchange(124, "3".repeat(64), token),
    /INVITE_INVALID/,
  );
  await assert.rejects(
    as(owner, "select telegram_invite($1,$2)", ["d".repeat(64), customer]),
    /ALREADY_LINKED/,
  );
  assert.equal(await telegramExchange(123, "3".repeat(64)), client);
  await db.query(
    "update organization_members set active=false where user_id=$1",
    [client],
  );
  await assert.rejects(telegramExchange(123, "4".repeat(64)), /FORBIDDEN/);
  await db.query(
    "update organization_members set active=true where user_id=$1",
    [client],
  );
  assert.equal(await telegramExchange(123, "4".repeat(64)), client);
  // Self invitation permits the owner but never lets their token replace a linked client's identity.
  await as(owner, "select telegram_invite($1,null)", ["e".repeat(64)]);
  assert.equal(
    await telegramExchange(123, "5".repeat(64), "e".repeat(64)),
    client,
  );
  assert.equal(
    await telegramExchange(125, "6".repeat(64), "e".repeat(64)),
    owner,
  );
});
test("expired invitations and invitations from a deactivated owner are rejected", async () => {
  const token = "f".repeat(64);
  await as(other, "select telegram_invite($1,null)", [token]);
  await db.query(
    "update private.telegram_invites set expires_at=now()-interval '1 second' where token_hash=$1",
    [token],
  );
  await assert.rejects(
    telegramExchange(126, "7".repeat(64), token),
    /INVITE_INVALID/,
  );
  // Remove only test bindings so the previously invited client can be invited again.
  await db.query("delete from private.telegram_accounts where user_id=$1", [
    client,
  ]);
  await db.query("delete from private.telegram_invites where token_hash=$1", [
    token,
  ]);
  const customer = (await state(client)).customers[0].id;
  await as(owner, "select telegram_invite($1,$2)", [token, customer]);
  await db.query(
    "update organization_members set active=false where user_id=$1",
    [owner],
  );
  await assert.rejects(
    telegramExchange(126, "7".repeat(64), token),
    /INVITE_INVALID/,
  );
  await db.query(
    "update organization_members set active=true where user_id=$1",
    [owner],
  );
});
