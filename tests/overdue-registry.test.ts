import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { shim, seed } from "./fixtures/seed";
import { TEST_USERS, TENANT, OTHER_TENANT } from "./fixtures/ids";
let db: PGlite, contract: string, report: string;
const subject = randomUUID();
async function as(user: string | null, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role " + (user ? "authenticated" : "anon"));
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    return tx.query<any>(sql, args);
  });
}
before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(shim);
  for (const f of (await readdir("supabase/migrations")).sort())
    if (f.endsWith(".sql"))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    await readFile("supabase/pending/premium_cabinets.sql", "utf8"),
  );
  await seed(db);
  await db.query("insert into auth.users(id) values($1)", [subject]);
  await db.query(
    "insert into public.profiles(id,display_name) values($1,'Test Subject')",
    [subject],
  );
  await db.query(
    "insert into public.buyer_profiles(user_id,active_tenant) values($1,$2)",
    [subject, TENANT],
  );
  contract = (
    await db.query<any>("select id from contracts where number='RF-26-0003'")
  ).rows[0].id;
  await db.query(
    "update customers set phone='+7 (999) 123-45-67',auth_user_id=$1 where id=(select customer_id from contracts where id=$2)",
    [subject, contract],
  );
});
after(async () => {
  await db?.close();
});
test("platform customer directory is private and includes buyers without a seller", async () => {
  for (const u of [null, subject, TEST_USERS.owner.id, TEST_USERS.other.id])
    await assert.rejects(
      as(u, "select platform_customers()"),
      /FORBIDDEN|permission denied/,
    );
  await db.query(
    "update buyer_profiles set name='Directory Test Buyer',active_tenant=null where user_id=$1",
    [subject],
  );
  const rows = (
    await as(
      TEST_USERS.platform.id,
      "select platform_customers('Directory Test Buyer',0) r",
    )
  ).rows[0].r;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "user:" + subject);
  assert.equal(rows[0].companies.length, 1);
  assert.deepEqual(
    (
      await as(
        TEST_USERS.platform.id,
        "select platform_customers('Directory Test Buyer',50) r",
      )
    ).rows[0].r,
    [],
  );
  assert.deepEqual(
    (
      await as(
        TEST_USERS.platform.id,
        "select platform_customers('unknown-name-12345',0) r",
      )
    ).rows[0].r,
    [],
  );
});
test("only the contract's owner can manually publish an actual overdue balance", async () => {
  for (const u of [null, TEST_USERS.other.id, TEST_USERS.manager.id, subject])
    await assert.rejects(
      as(u, "select overdue_registry_add($1,'consent ref',true)", [contract]),
      /FORBIDDEN|permission denied/,
    );
  await assert.rejects(
    as(
      TEST_USERS.owner.id,
      "select overdue_registry_add($1,'consent ref',false)",
      [contract],
    ),
    /подтвердите/,
  );
  const current = (
    await db.query<any>("select id from contracts where number='RF-26-0001'")
  ).rows[0].id;
  await assert.rejects(
    as(
      TEST_USERS.owner.id,
      "select overdue_registry_add($1,'consent ref',true)",
      [current],
    ),
    /нет подтверждённой/,
  );
  report = (
    await as(
      TEST_USERS.owner.id,
      "select overdue_registry_add($1,'consent ref',true) id",
      [contract],
    )
  ).rows[0].id;
  assert.equal(
    (
      await as(
        TEST_USERS.owner.id,
        "select overdue_registry_add($1,'consent ref',true) id",
        [contract],
      )
    ).rows[0].id,
    report,
  );
  assert.equal(
    (await db.query<any>("select count(*)::int n from private.overdue_reports"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from private.telegram_deliveries where event_key=$1",
        ["registry-add:" + report],
      )
    ).rows[0].n,
    1,
  );
});
test("cross-company search is exact, limited, redacted and cannot mutate other reports", async () => {
  await assert.rejects(
    as(subject, "select overdue_registry_state('89991234567')"),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(TEST_USERS.other.id, "select overdue_registry_state('999')"),
    /полный номер/,
  );
  assert.deepEqual(
    (await as(TEST_USERS.other.id, "select overdue_registry_state() r")).rows[0]
      .r,
    [],
  );
  const r = (
    await as(
      TEST_USERS.other.id,
      "select overdue_registry_state('89991234567') r",
    )
  ).rows[0].r[0];
  assert.equal(r.id, report);
  assert.equal(r.phone, null);
  assert.equal(r.basis_reference, null);
  assert.equal(r.can_withdraw, false);
  assert.match(r.name, /…/);
  assert.equal(r.contract_id, undefined);
  await assert.rejects(
    as(
      TEST_USERS.other.id,
      "select overdue_registry_change($1,'withdraw','false report')",
      [report],
    ),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(TEST_USERS.other.id, "select * from private.overdue_reports"),
    /permission denied/,
  );
  await db.query(
    "insert into company_access(tenant_id,status) values($1,'blocked')",
    [OTHER_TENANT],
  );
  await assert.rejects(
    as(TEST_USERS.other.id, "select overdue_registry_state('89991234567')"),
    /FORBIDDEN/,
  );
  await db.query(
    "update company_access set status='active' where tenant_id=$1",
    [OTHER_TENANT],
  );
});
test("only the subject can dispute and the flag is visible to searchers", async () => {
  await assert.rejects(
    as(
      TEST_USERS.client.id,
      "select overdue_registry_change($1,'dispute','not my debt')",
      [report],
    ),
    /FORBIDDEN/,
  );
  await as(
    subject,
    "select overdue_registry_change($1,'dispute','Payment needs checking')",
    [report],
  );
  const r = (
    await as(
      TEST_USERS.other.id,
      "select overdue_registry_state('89991234567') r",
    )
  ).rows[0].r[0];
  assert.equal(r.status, "disputed");
  assert.equal(r.dispute_reason, null);
});
test("confirmed payment updates reported arrears without exposing later installments", async () => {
  const amount = (
    await db.query<any>(
      "select amount::text from private.registry_balance($1,current_date-1)",
      [contract],
    )
  ).rows[0].amount;
  const account = (
    await db.query<any>(
      "select id from cash_accounts where tenant_id=$1 limit 1",
      [TENANT],
    )
  ).rows[0].id;
  await as(
    TEST_USERS.owner.id,
    "select app_command('payment.record',$1::jsonb,$2::uuid)",
    [
      JSON.stringify({
        contract_id: contract,
        cash_account_id: account,
        amount,
        paid_on: new Date().toISOString().slice(0, 10),
      }),
      randomUUID(),
    ],
  );
  const r = (
    await as(
      TEST_USERS.other.id,
      "select overdue_registry_state('89991234567') r",
    )
  ).rows[0].r[0];
  assert.equal(r.status, "resolved");
  assert.equal(r.amount, "0");
  assert.equal(r.disputed, true);
});
test("withdrawal removes public search result, preserves audit and private history", async () => {
  await as(
    TEST_USERS.platform.id,
    "select overdue_registry_change($1,'withdraw','Reviewed and withdrawn')",
    [report],
  );
  assert.deepEqual(
    (
      await as(
        TEST_USERS.other.id,
        "select overdue_registry_state('89991234567') r",
      )
    ).rows[0].r,
    [],
  );
  assert.equal(
    (await as(TEST_USERS.owner.id, "select overdue_registry_state() r")).rows[0]
      .r[0].status,
    "withdrawn",
  );
  await assert.rejects(
    as(subject, "select overdue_registry_state()"),
    /FORBIDDEN/,
  );
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from private.overdue_audit where report_id=$1",
        [report],
      )
    ).rows[0].n,
    3,
  );
});
