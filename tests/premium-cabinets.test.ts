import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { shim, seed } from "../src/lib/seed";
import { DEMO_USERS, TENANT, OTHER_TENANT } from "../src/lib/demo-ids";
let db: PGlite;
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
  await seed(db);
  await db.exec(await readFile("supabase/pending/telegram_admin_bootstrap.sql", "utf8"));
});
after(async () => {
  await db?.close();
});
test("admin bootstrap requires allowlisted signed identity, matching link and single use", async () => {
  const user = randomUUID();
  const id = 8123456789;
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("insert into profiles(id,display_name) values($1,'Test')", [user]);
  await db.query("insert into buyer_profiles(user_id) values($1)", [user]);
  await db.query("insert into private.telegram_admin_bootstrap(telegram_id) values($1)", [id]);
  const call = (tg: number, u: string | null = null) => db.transaction(async tx => {
    await tx.exec("set local role service_role");
    return (await tx.query<{ok:boolean}>("select telegram_admin_bootstrap($1,$2) as ok", [tg,u])).rows[0].ok;
  });
  assert.equal(await call(id+1),false);
  assert.equal(await call(id),true);
  await assert.rejects(as(null,"select telegram_admin_bootstrap($1,$2)",[id,user]),/permission denied/);
  await assert.rejects(as(user,"select telegram_admin_bootstrap($1,$2)",[id,user]),/permission denied/);
  await assert.rejects(call(id,user),/FORBIDDEN/);
  await db.query("insert into private.telegram_accounts(telegram_id,user_id) values($1,$2)",[id,user]);
  assert.equal(await call(id,user),true);
  assert.equal(await call(id,user),false);
  const s=(await as(user,"select session_context() as s")).rows[0].s;
  assert.equal(s.platform_admin,true);
  assert.equal(s.role,null);
});
test("payment details: owner writes, client reads own seller, other tenant cannot read", async () => {
  await as(
    DEMO_USERS.owner.id,
    "select save_seller_payment_methods('+79990000000','Тестовый банк','Тестовый получатель',true,'По договорённости')",
  );
  assert.equal(
    (await as(DEMO_USERS.client.id, "select * from seller_payment_methods"))
      .rows[0].tenant_id,
    TENANT,
  );
  assert.equal(
    (await as(DEMO_USERS.other.id, "select * from seller_payment_methods")).rows
      .length,
    0,
  );
  await assert.rejects(
    as(
      DEMO_USERS.client.id,
      "select save_seller_payment_methods('+79990000000','Чужой банк','Чужой получатель',false,'')",
    ),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(DEMO_USERS.owner.id, "update seller_payment_methods set tenant_id=$1", [
      OTHER_TENANT,
    ]),
    /permission denied/,
  );
  await assert.rejects(
    as(null, "select * from seller_payment_methods"),
    /permission denied/,
  );
});
test("invalid payment details cannot replace valid recipient", async () => {
  await assert.rejects(
    as(
      DEMO_USERS.owner.id,
      "select save_seller_payment_methods('+123','Банк','Имя',true,'')",
    ),
  );
  assert.equal(
    (
      await as(
        DEMO_USERS.owner.id,
        "select sbp_phone from seller_payment_methods",
      )
    ).rows[0].sbp_phone,
    "+79990000000",
  );
});
test("only platform administrator may issue a merchant activation code", async () => {
  await assert.rejects(
    as(DEMO_USERS.owner.id, "select platform_owner_invite($1,$2)", [
      DEMO_USERS.other.id,
      hash(),
    ]),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(null, "select platform_owner_invite($1,$2)", [
      DEMO_USERS.other.id,
      hash(),
    ]),
    /permission denied/,
  );
});
test("new merchant receives isolated empty cabinet and single-use code", async () => {
  const user = randomUUID(),
    code = hash();
  await db.query(
    "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{\"rajab_pending_merchant\":true}')",
    [user, `merchant-${user}@telegram.invalid`],
  );
  const r = (
    await as(
      DEMO_USERS.platform.id,
      "select platform_create_merchant($1,'Магазин тест','Владелец тест',$2) as v",
      [user, code],
    )
  ).rows[0].v;
  assert.ok(r.tenant_id);
  assert.notEqual(r.tenant_id, TENANT);
  assert.equal((await as(user, "select * from customers")).rows.length, 0);
  assert.equal((await as(user, "select * from contracts")).rows.length, 0);
  assert.equal((await as(user, "select * from cash_accounts")).rows.length, 2);
  assert.equal(
    (await as(user, "select * from organization_settings")).rows.length,
    1,
  );
  await assert.rejects(
    as(
      DEMO_USERS.owner.id,
      "select platform_create_merchant($1,'Другой','Имя',$2)",
      [user, hash()],
    ),
    /FORBIDDEN/,
  );
  const redeem = async (tg: number) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return tx.query<any>("select telegram_exchange($1,$2,$3) as id", [
        tg,
        hash(),
        code,
      ]);
    });
  assert.equal((await redeem(7234000001)).rows[0].id, user);
  await assert.rejects(redeem(7234000002), /TELEGRAM_INVITE_INVALID/);
  assert.equal(
    (await as(user, "select session_context() as s")).rows[0].s.role,
    "owner",
  );
});
test("merchant provisioning rejects an unrelated auth user and rolls back all organization writes", async () => {
  const user = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [user]);
  const before = (
    await db.query<any>("select count(*) as n from organizations")
  ).rows[0].n;
  await assert.rejects(
    as(
      DEMO_USERS.platform.id,
      "select platform_create_merchant($1,'Магазин','Владелец',$2)",
      [user, hash()],
    ),
    /FORBIDDEN/,
  );
  assert.equal(
    (await db.query<any>("select count(*) as n from organizations")).rows[0].n,
    before,
  );
});
