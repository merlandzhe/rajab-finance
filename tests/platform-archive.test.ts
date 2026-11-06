import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { shim, seed } from "./fixtures/seed";
import { TEST_USERS, TENANT } from "./fixtures/ids";
let db: PGlite;
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
});
after(async () => {
  await db?.close();
});
test("only platform owner can archive; active contracts and owner identities are protected", async () => {
  for (const u of [null, TEST_USERS.owner.id, TEST_USERS.client.id])
    await assert.rejects(
      as(u, "select platform_archive($1,false,true)", ["company:" + TENANT]),
      /FORBIDDEN|permission denied/,
    );
  await assert.rejects(
    as(TEST_USERS.platform.id, "select platform_archive($1,false,true)", [
      "company:" + TENANT,
    ]),
    /действующие договоры/,
  );
  await assert.rejects(
    as(TEST_USERS.platform.id, "select platform_archive($1,false,true)", [
      "user:" + TEST_USERS.platform.id,
    ]),
    /владельца/,
  );
});
test("company deletion is recoverable and cannot be re-enabled while archived", async () => {
  const id = randomUUID();
  await db.query(
    "insert into organizations(id,name,slug) values($1,'Archive company',$2)",
    [id, id],
  );
  await as(TEST_USERS.platform.id, "select platform_archive($1,false,true)", [
    "company:" + id,
  ]);
  assert.equal(
    (await db.query<any>("select private.company_enabled($1) ok", [id])).rows[0]
      .ok,
    false,
  );
  await as(
    TEST_USERS.platform.id,
    "select platform_company_access($1,'active',null)",
    [id],
  );
  assert.equal(
    (await db.query<any>("select private.company_enabled($1) ok", [id])).rows[0]
      .ok,
    false,
  );
  await as(TEST_USERS.platform.id, "select platform_archive($1,true,true)", [
    "company:" + id,
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from organizations where id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await db.query<any>("select private.company_enabled($1) ok",[id])).rows[0].ok,false);
});
test("buyer deletion hides directory entry, disables registration and restores account", async () => {
  const id = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query(
    "insert into buyer_profiles(user_id,name,active) values($1,'Archive buyer',true)",
    [id],
  );
  await as(TEST_USERS.platform.id, "select platform_archive($1,false,true)", [
    "user:" + id,
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select active from buyer_profiles where user_id=$1",
        [id],
      )
    ).rows[0].active,
    false,
  );
  assert.deepEqual(
    (
      await as(
        TEST_USERS.platform.id,
        "select platform_customer_directory('Archive buyer',0,false) r",
      )
    ).rows[0].r,
    [],
  );
  assert.equal(
    (
      await as(
        TEST_USERS.platform.id,
        "select platform_customer_directory('Archive buyer',0,true) r",
      )
    ).rows[0].r.length,
    1,
  );
  await as(TEST_USERS.platform.id, "select platform_archive($1,false,true)", [
    "user:" + id,
  ]);
  await as(TEST_USERS.platform.id, "select platform_archive($1,true,true)", [
    "user:" + id,
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select active from buyer_profiles where user_id=$1",
        [id],
      )
    ).rows[0].active,
    true,
  );
  await assert.rejects(
    as(id, "select platform_customer_directory('',0,true)"),
    /FORBIDDEN/,
  );
});
