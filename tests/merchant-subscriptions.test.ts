import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { shim, seed } from "../src/lib/seed";
import { DEMO_USERS, TENANT, OTHER_TENANT } from "../src/lib/demo-ids";
import { merchantRequestInput, whatsappUrl } from "../src/lib/merchant-input";
let db: PGlite;
const buyer = randomUUID(),
  stranger = randomUUID();
let rid: string, tenant: string, code: string;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
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
  await db.exec(
    await readFile("supabase/pending/server_rpc_permissions.sql", "utf8"),
  );
  await seed(db);
  for (const [u, tg] of [
    [buyer, 81234500001],
    [stranger, 81234500002],
  ] as const) {
    await db.query("insert into auth.users(id) values($1)", [u]);
    await db.query("insert into profiles(id,display_name) values($1,'Test')", [
      u,
    ]);
    await db.query("insert into buyer_profiles(user_id) values($1)", [u]);
    await db.query(
      "insert into private.telegram_accounts(telegram_id,user_id,username) values($1,$2,'verified_user')",
      [tg, u],
    );
  }
});
after(async () => {
  await db?.close();
});
test("request derives Telegram identity from server link and is idempotent", async () => {
  await assert.rejects(
    as(
      null,
      "select merchant_request_submit('Test','Shop','City','+79990000000')",
    ),
    /permission denied/,
  );
  rid = (
    await as(
      buyer,
      "select merchant_request_submit('Test','Shop','City','+79990000000') as id",
    )
  ).rows[0].id;
  assert.equal(
    (
      await as(
        buyer,
        "select merchant_request_submit('Other','Other','City','+79990000000') as id",
      )
    ).rows[0].id,
    rid,
  );
  const row = (await as(buyer, "select * from merchant_requests")).rows[0];
  assert.equal(row.telegram_id, 81234500001);
  assert.equal(row.username, "verified_user");
  assert.equal(
    (await as(stranger, "select * from merchant_requests")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from private.telegram_deliveries where event_key=$1",
        ["merchant-request:" + rid],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    merchantRequestInput.safeParse({
      name: "Test",
      shop_name: "Shop",
      city: "City",
      phone: "+79990000000",
      telegram_id: 1,
    }).success,
    false,
  );
  await assert.rejects(
    as(buyer, "update merchant_requests set status='activated'"),
    /permission denied/,
  );
});
test("only platform admin issues codes; code is bound to applicant and new company", async () => {
  code = hash();
  await assert.rejects(
    as(buyer, "select platform_issue_code($1,$2,30)", [rid, code]),
    /FORBIDDEN/,
  );
  tenant = (
    await as(DEMO_USERS.platform.id, "select platform_issue_code($1,$2,30) r", [
      rid,
      code,
    ])
  ).rows[0].r.tenant_id;
  assert.notEqual(tenant, TENANT);
  await assert.rejects(
    as(stranger, "select merchant_activate($1)", [code]),
    /Код недействителен/,
  );
  await assert.rejects(
    as(buyer, "select platform_access_state()"),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(buyer, "select * from private.merchant_codes"),
    /permission denied/,
  );
  assert.equal((await as(buyer, "select * from contracts")).rows.length, 0);
});
test("reissue revokes old code and expiry is enforced", async () => {
  const next = hash();
  const issued = (
    await as(DEMO_USERS.platform.id, "select platform_issue_code($1,$2,30) r", [
      rid,
      next,
    ])
  ).rows[0].r;
  await assert.rejects(
    as(buyer, "select merchant_activate($1)", [code]),
    /Код недействителен/,
  );
  await db.query(
    "update private.merchant_codes set expires_at=now()-interval '1 second' where id=$1",
    [issued.id],
  );
  await assert.rejects(
    as(buyer, "select merchant_activate($1)", [next]),
    /Код недействителен/,
  );
  code = hash();
  const revoked = (
    await as(DEMO_USERS.platform.id, "select platform_issue_code($1,$2,30) r", [
      rid,
      code,
    ])
  ).rows[0].r;
  await as(DEMO_USERS.platform.id, "select platform_revoke_code($1)", [
    revoked.id,
  ]);
  await assert.rejects(
    as(buyer, "select merchant_activate($1)", [code]),
    /Код недействителен/,
  );
  code = hash();
  await as(DEMO_USERS.platform.id, "select platform_issue_code($1,$2,30)", [
    rid,
    code,
  ]);
});
test("activation consumes code once and retains buyer profile", async () => {
  await as(buyer, "select merchant_activate($1)", [code]);
  await assert.rejects(
    as(buyer, "select merchant_activate($1)", [code]),
    /Код недействителен/,
  );
  const s = (await as(buyer, "select session_context() s")).rows[0].s;
  assert.equal(s.role, "owner");
  assert.equal(s.tenant_id, tenant);
  assert.equal(
    (await as(buyer, "select * from buyer_profiles")).rows.length,
    1,
  );
  assert.equal((await as(buyer, "select * from customers")).rows.length, 0);
  assert.equal((await as(buyer, "select * from cash_accounts")).rows.length, 2);
  await as(buyer, "select save_shop('Shop name','79990000000','',true)");
  assert.equal(
    (
      await as(stranger, "select * from seller_directory where tenant_id=$1", [
        tenant,
      ])
    ).rows[0].whatsapp_phone,
    "79990000000",
  );
  assert.equal(whatsappUrl("79990000000"), "https://wa.me/79990000000");
  assert.equal(whatsappUrl("javascript:alert(1)"), null);
});
test("blocking and expiry revoke existing staff reads and writes; buyer records remain", async () => {
  await as(
    DEMO_USERS.platform.id,
    "select platform_company_access($1,'blocked',null)",
    [tenant],
  );
  assert.equal((await as(buyer, "select * from cash_accounts")).rows.length, 0);
  assert.equal(
    (await as(buyer, "select my_company_access() a")).rows[0].a.allowed,
    false,
  );
  await assert.rejects(
    as(buyer, "select save_shop('Bypass','79990000000','',true)"),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(
      buyer,
      "select app_command('customer.create','{\"name\":\"Bypass\"}',$1)",
      [randomUUID()],
    ),
    /прав/,
  );
  await assert.rejects(
    as(
      buyer,
      'select portal_command(\'portal.directory\',\'{"display_name":"Bypass","enabled":true}\',$1)',
      [randomUUID()],
    ),
    /FORBIDDEN/,
  );
  assert.equal(
    (
      await as(stranger, "select * from seller_directory where tenant_id=$1", [
        tenant,
      ])
    ).rows.length,
    0,
  );
  await as(
    DEMO_USERS.platform.id,
    "select platform_company_access($1,'active',now()-interval '1 second')",
    [tenant],
  );
  assert.equal(
    (await as(buyer, "select my_company_access() a")).rows[0].a.allowed,
    false,
  );
  await as(
    DEMO_USERS.platform.id,
    "select platform_company_access($1,'active',now()+interval '30 days')",
    [tenant],
  );
  assert.equal(
    (await as(buyer, "select my_company_access() a")).rows[0].a.allowed,
    true,
  );
  await assert.rejects(
    as(buyer, "select platform_company_access($1,'active',null)", [
      OTHER_TENANT,
    ]),
    /FORBIDDEN/,
  );
  const before = (await as(DEMO_USERS.client.id, "select * from contracts"))
    .rows.length;
  await as(
    DEMO_USERS.platform.id,
    "select platform_company_access($1,'blocked',null)",
    [TENANT],
  );
  assert.equal(
    (await as(DEMO_USERS.client.id, "select * from contracts")).rows.length,
    before,
  );
  await as(
    DEMO_USERS.platform.id,
    "select platform_company_access($1,'active',null)",
    [TENANT],
  );
});
test("platform notices cannot be sent to ordinary recipients", async () => {
  assert.equal(
    (
      await db.query<any>(
        "select private.notification_recipient_allowed(null,$1) ok",
        [buyer],
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query<any>(
        "select private.notification_recipient_allowed(null,$1) ok",
        [DEMO_USERS.platform.id],
      )
    ).rows[0].ok,
    true,
  );
  await assert.rejects(
    as(buyer, "select telegram_identity_update(81234500001,$1,'spoof')", [
      buyer,
    ]),
    /permission denied/,
  );
});
