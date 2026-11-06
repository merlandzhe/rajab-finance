import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { shim, seed } from "../src/lib/seed";
import { TENANT, OTHER_TENANT, DEMO_USERS } from "../src/lib/demo-ids";
import { today } from "../src/lib/money";
import { verifiedContact, validSecret } from "../src/lib/telegram-contact";
import { telegramEmail } from "../src/lib/telegram-registration";
let db: PGlite;
const owner = DEMO_USERS.owner.id,
  other = DEMO_USERS.other.id;
const buyer = randomUUID(),
  second = randomUUID();
let appId: string;
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
async function as(user: string | null, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role " + (user ? "authenticated" : "anon"));
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    return tx.query<any>(sql, args);
  });
}
async function service(sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query<any>(sql, args);
  });
}
async function portal(
  user: string,
  action: string,
  payload: unknown,
  key = randomUUID(),
) {
  return (
    await as(user, "select portal_command($1,$2::jsonb,$3) as v", [
      action,
      JSON.stringify(payload),
      key,
    ])
  ).rows[0].v;
}
async function state(user: string) {
  return (await as(user, "select app_state() as v")).rows[0].v;
}
async function signup(user: string, tg: number) {
  await db.query<any>(
    "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{\"rajab_telegram_buyer\":true}')",
    [user, telegramEmail(tg)],
  );
  return service("select telegram_register_buyer($1,$2,$3,$4) as id", [
    tg,
    digest(),
    user,
    telegramEmail(tg),
  ]);
}
async function onboard(user: string, tg: number, update: number) {
  await as(user, "select buyer_request_phone()");
  await service("select telegram_verify_phone($1,$2,$3,$4)", [
    tg,
    "+79990000000",
    Math.floor(Date.now() / 1000),
    update,
  ]);
  await as(
    user,
    "select buyer_profile_save('Тестовый покупатель','Раменское',true)",
  );
  await as(user, "select buyer_select($1)", [TENANT]);
}
before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(shim);
  await db.exec("set timezone='Europe/Moscow'");
  for (const f of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await seed(db);
  await portal(owner, "portal.directory", {
    display_name: "Раджап",
    enabled: true,
  });
  await portal(other, "portal.directory", {
    display_name: "Другой продавец",
    enabled: true,
  });
});
after(async () => {
  await db.close();
});
test("self registration grants buyer only, resumes provisioning, rejects replay and direct RPC", async () => {
  await signup(buyer, 777001);
  const context = (await as(buyer, "select session_context() as v")).rows[0].v;
  assert.equal(context.role, "client");
  assert.equal(context.tenant_id, null);
  assert.equal(context.platform_admin, false);
  assert.equal((await state(buyer)).applications.length, 0);
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int as n from organization_members where user_id=$1",
        [buyer],
      )
    ).rows[0].n,
    0,
  );
  const d = digest();
  await service("select telegram_exchange($1,$2,null)", [777001, d]);
  await assert.rejects(
    service("select telegram_exchange($1,$2,null)", [777001, d]),
    /REPLAY/,
  );
  await assert.rejects(
    as(buyer, "select telegram_register_buyer($1,$2,$3,$4)", [
      777002,
      digest(),
      buyer,
      telegramEmail(777001),
    ]),
    /permission denied/,
  );
  await assert.rejects(
    service("select telegram_register_buyer($1,$2,$3,$4)", [
      777003,
      digest(),
      owner,
      telegramEmail(777003),
    ]),
    /FORBIDDEN/,
  );
  await assert.rejects(
    as(buyer, "select buyer_select($1)", [TENANT]),
    /телефон/,
  );
  await assert.rejects(
    as(buyer, "update buyer_profiles set phone_verified_at=now()"),
    /permission denied/,
  );
});
test("phone requires fresh requested contact; verified profile unlocks seller choice", async () => {
  await service("select telegram_verify_phone($1,$2,$3,$4)", [
    777001,
    "+79990000000",
    Math.floor(Date.now() / 1000),
    1,
  ]);
  assert.equal(
    (await as(buyer, "select buyer_state() as v")).rows[0].v.profile
      .phone_verified_at,
    null,
  );
  await assert.rejects(
    as(buyer, "select buyer_profile_save('Покупатель','Москва',true)"),
    /подтвердите/,
  );
  await onboard(buyer, 777001, 2);
  await signup(second, 777002);
  await onboard(second, 777002, 3);
  const b = (await as(buyer, "select buyer_state() as v")).rows[0].v;
  assert.equal(b.profile.phone, "+79990000000");
  assert.equal(b.sellers.length, 2);
  assert.equal(
    (await as(buyer, "select session_context() as v")).rows[0].v.tenant_id,
    TENANT,
  );
  await assert.rejects(as(owner, "select buyer_select($1)", [TENANT]));
});
test("buyer applications are isolated; seller switching prevents stale-tab writes and preserves old contracts", async () => {
  const payload = {
    product_name: "Тестовый ноутбук",
    estimated_cost: "1000000",
    down_payment: "0",
    months: 6,
    notes: "",
    expected_tenant: TENANT,
  };
  const key = randomUUID();
  const a = await portal(buyer, "portal.application", payload, key);
  appId = a.id;
  assert.equal(
    (await portal(buyer, "portal.application", payload, key)).id,
    a.id,
  );
  assert.ok((await state(owner)).applications.some((x: any) => x.id === a.id));
  assert.ok(
    !(await state(second)).applications.some((x: any) => x.id === a.id),
  );
  assert.ok(!(await state(other)).applications.some((x: any) => x.id === a.id));
  await assert.rejects(
    portal(buyer, "portal.confirm", {
      id: randomUUID(),
      cash_account_id: randomUUID(),
      expected_tenant: TENANT,
    }),
  );
  await as(buyer, "select buyer_select($1)", [OTHER_TENANT]);
  assert.equal((await state(buyer)).applications.length, 0);
  await assert.rejects(
    portal(buyer, "portal.application", payload),
    /Предприниматель изменён/,
  );
  await portal(buyer, "portal.application", {
    ...payload,
    expected_tenant: OTHER_TENANT,
  });
  assert.equal((await state(buyer)).applications.length, 1);
  await as(buyer, "select buyer_select($1)", [TENANT]);
  assert.equal((await state(buyer)).applications.length, 1);
});
test("clarification exchange is authorized, idempotent, and restores review", async () => {
  const key = randomUUID();
  const q = { id: appId, message: "Уточните модель товара" };
  await portal(owner, "portal.clarify", q, key);
  await portal(owner, "portal.clarify", q, key);
  assert.equal((await state(buyer)).application_messages.length, 1);
  await assert.rejects(
    portal(second, "portal.reply", {
      id: appId,
      message: "Чужой ответ",
      expected_tenant: TENANT,
    }),
    /FORBIDDEN/,
  );
  await portal(buyer, "portal.reply", {
    id: appId,
    message: "Модель тест 2026",
    expected_tenant: TENANT,
  });
  assert.equal((await state(buyer)).applications[0].status, "review");
  assert.equal((await state(buyer)).application_messages.length, 2);
  assert.equal((await state(second)).application_messages.length, 0);
  await assert.rejects(
    portal(buyer, "portal.clarify", { ...q, expected_tenant: TENANT }),
  );
});
test("disabled seller stops new applications, keeps the existing relationship readable", async () => {
  await portal(owner, "portal.directory", {
    display_name: "Раджап",
    enabled: false,
  });
  await assert.rejects(
    portal(buyer, "portal.application", {
      product_name: "Товар",
      estimated_cost: "10000",
      down_payment: "0",
      months: 3,
      expected_tenant: TENANT,
    }),
    /приостановлен/,
  );
  assert.ok((await state(buyer)).applications.some((a: any) => a.id === appId));
  await portal(owner, "portal.directory", {
    display_name: "Раджап",
    enabled: true,
  });
});
test("notification queue isolates recipients, leases and deduplicates reminders by Moscow day", async () => {
  // Existing demo client has a real ledger and schedule; link only synthetic TG IDs.
  await db.query<any>(
    "insert into private.telegram_accounts(telegram_id,user_id) values($1,$2)",
    [888001, owner],
  );
  await db.query<any>(
    "insert into private.telegram_accounts(telegram_id,user_id) values($1,$2)",
    [888002, DEMO_USERS.client.id],
  );
  await service("select queue_buyer_reminders()");
  const count1 = (
    await db.query<any>(
      "select count(*)::int as n from private.telegram_deliveries",
    )
  ).rows[0].n;
  await service("select queue_buyer_reminders()");
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int as n from private.telegram_deliveries",
      )
    ).rows[0].n,
    count1,
  );
  const claimed = (await service("select * from claim_buyer_notifications()"))
    .rows;
  assert.ok(claimed.length > 0);
  assert.ok(claimed.length <= 5);
  const next = (await service("select * from claim_buyer_notifications()"))
    .rows;
  assert.ok(next.every((n: any) => !claimed.some((c: any) => c.id === n.id)));
  await service("select finish_buyer_notification($1,$2,true)", [
    claimed[0].id,
    randomUUID(),
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select status from private.telegram_deliveries where id=$1",
        [claimed[0].id],
      )
    ).rows[0].status,
    "sending",
  );
  await service("select finish_buyer_notification($1,$2,true)", [
    claimed[0].id,
    claimed[0].lease,
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select status from private.telegram_deliveries where id=$1",
        [claimed[0].id],
      )
    ).rows[0].status,
    "sent",
  );
  await assert.rejects(
    as(buyer, "select * from private.telegram_deliveries"),
    /permission denied/,
  );
  await assert.rejects(
    as(buyer, "select * from claim_buyer_notifications()"),
    /permission denied/,
  );
});
test("webhook contact validation rejects forged, forwarded, stale and non-private contacts", () => {
  const now = Math.floor(Date.now() / 1000);
  const msg = {
    date: now,
    from: { id: 123, is_bot: false },
    chat: { id: 123, type: "private" },
    contact: { user_id: 123, phone_number: "79990000000" },
  };
  assert.equal(
    verifiedContact({ update_id: 10, message: msg })?.phone,
    "+79990000000",
  );
  for (const m of [
    { ...msg, contact: { ...msg.contact, user_id: 124 } },
    { ...msg, chat: { ...msg.chat, type: "group" } },
    { ...msg, date: now - 901 },
    { ...msg, from: { id: 124 } },
    { ...msg, contact: { phone_number: "79990000000" } },
  ])
    assert.equal(verifiedContact({ update_id: 11, message: m }), null);
  assert.ok(validSecret("correct", "correct"));
  assert.ok(!validSecret("wrong", "correct"));
  assert.ok(!validSecret(null, undefined));
});

test("product photos stay inside the buyer application and cannot impersonate purchase receipts", async () => {
  const path = `${TENANT}/${appId}/${randomUUID()}.jpg`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('deal-documents',$1)",
    [path],
  );
  const p = {
    id: appId,
    expected_tenant: TENANT,
    storage_path: path,
    name: "Товар.jpg",
    mime_type: "image/jpeg",
    size_bytes: 100,
    sha256: "a".repeat(64),
  };
  await assert.rejects(portal(second, "portal.photo", p), /FORBIDDEN/);
  const photo = await portal(buyer, "portal.photo", p);
  assert.equal(
    (await state(buyer)).documents.find((d: any) => d.id === photo.id).kind,
    "product_photo",
  );
  assert.ok((await state(owner)).documents.some((d: any) => d.id === photo.id));
  assert.ok(
    !(await state(second)).documents.some((d: any) => d.id === photo.id),
  );
  await assert.rejects(
    portal(buyer, "portal.photo", {
      ...p,
      storage_path: `${OTHER_TENANT}/${appId}/x.jpg`,
    }),
    /Файл/,
  );
  await assert.rejects(
    portal(buyer, "portal.photo", { ...p, mime_type: "application/pdf" }),
    /фото/,
  );
});

test("new buyer full deal, three-day reminder, claims and confirmed repayment reconcile", async () => {
  const cmd = async (action: string, payload: unknown) =>
    (
      await as(owner, "select app_command($1,$2::jsonb,$3) as v", [
        action,
        JSON.stringify(payload),
        randomUUID(),
      ])
    ).rows[0].v;
  await cmd("application.transition", { id: appId, status: "approved" });
  await cmd("application.transition", {
    id: appId,
    status: "awaiting_purchase",
  });
  const path = `${TENANT}/${appId}/${randomUUID()}.pdf`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('deal-documents',$1)",
    [path],
  );
  const doc = await cmd("document.register", {
    application_id: appId,
    kind: "purchase_receipt",
    storage_path: path,
    name: "Чек.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    sha256: "b".repeat(64),
  });
  await cmd("purchase.record", {
    id: appId,
    supplier: "Тестовый поставщик",
    cost: "1000000",
    purchased_on: today(),
    document_id: doc.id,
    ownership_confirmed: true,
  });
  const first = (
    await db.query<{ d: string }>("select (current_date+3)::text as d")
  ).rows[0].d;
  await cmd("quote.confirm", {
    id: appId,
    months: 3,
    down_payment: "0",
    first_payment_on: first,
    agreed: true,
  });
  const c = await cmd("contract.create", { id: appId });
  let s = await state(buyer);
  const contract = s.contracts.find((x: any) => x.id === c.id);
  assert.ok(contract);
  assert.equal(
    s.payment_schedules
      .filter((x: any) => x.contract_id === c.id)
      .reduce((n: bigint, x: any) => n + BigInt(x.amount), 0n),
    BigInt(contract.sale_price),
  );
  assert.equal(s.payments.filter((x: any) => x.contract_id === c.id).length, 0);
  const schedule = s.payment_schedules.find((x: any) => x.contract_id === c.id);
  await service("select queue_buyer_reminders()");
  const reminder = (
    await db.query<any>(
      "select * from private.telegram_deliveries where recipient=$1 and schedule_id=$2",
      [buyer, schedule.id],
    )
  ).rows;
  assert.equal(reminder.length, 1);
  assert.match(reminder[0].message, /Через 3 дня/);
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int as n from private.telegram_deliveries where recipient=$1 and schedule_id=$2",
        [owner, schedule.id],
      )
    ).rows[0].n,
    0,
  );
  const claim = await portal(buyer, "portal.claim", {
    contract_id: c.id,
    amount: String(contract.sale_price),
    paid_on: today(),
    method: "sbp",
    expected_tenant: TENANT,
  });
  assert.equal(
    (await state(buyer)).payments.filter((x: any) => x.contract_id === c.id)
      .length,
    0,
  );
  const cash = (await state(owner)).cash_accounts[0].id;
  const key = randomUUID();
  await portal(
    owner,
    "portal.confirm",
    { id: claim.id, cash_account_id: cash },
    key,
  );
  await portal(
    owner,
    "portal.confirm",
    { id: claim.id, cash_account_id: cash },
    key,
  );
  s = await state(buyer);
  assert.equal(s.payments.filter((x: any) => x.contract_id === c.id).length, 1);
  assert.equal(
    s.payment_claims.find((x: any) => x.id === claim.id).status,
    "confirmed",
  );
  assert.equal(
    s.payment_allocations
      .filter((x: any) =>
        s.payment_schedules.some(
          (ps: any) => ps.id === x.schedule_id && ps.contract_id === c.id,
        ),
      )
      .reduce((n: bigint, x: any) => n + BigInt(x.amount), 0n),
    BigInt(contract.sale_price),
  );
  assert.ok(
    (
      await db.query<any>(
        "select id from private.telegram_deliveries where recipient=$1 and event_key like 'payment:%'",
        [buyer],
      )
    ).rows.length > 0,
  );
  // Clear unrelated fixture leases, then verify an already-paid reminder is never claimed.
  await db.query(
    "update private.telegram_deliveries set status='sent' where id<>$1",
    [reminder[0].id],
  );
  assert.equal(
    (await service("select * from claim_buyer_notifications()")).rows.length,
    0,
  );
});

test("reminders cover day zero and overdue, exclude tomorrow and isolate seller recipients", async () => {
  const s = await state(DEMO_USERS.client.id);
  const c = s.contracts.find(
    (x: any) => x.status === "signed" || x.status === "transferred",
  );
  const ids: string[] = [];
  for (const offset of [-1, 0, 1, 3]) {
    const id = randomUUID();
    ids.push(id);
    await db.query(
      "insert into payment_schedules(id,tenant_id,contract_id,sequence,due_on,amount) values($1,$2,$3,$4,current_date+$5::int,100)",
      [id, TENANT, c.id, 100 + offset, offset],
    );
  }
  await service("select queue_buyer_reminders()");
  const rows = (
    await db.query<any>(
      "select * from private.telegram_deliveries where schedule_id=any($1::uuid[])",
      [ids],
    )
  ).rows;
  assert.equal(rows.filter((r: any) => r.schedule_id === ids[0]).length, 2);
  assert.equal(rows.filter((r: any) => r.schedule_id === ids[1]).length, 1);
  assert.equal(rows.filter((r: any) => r.schedule_id === ids[2]).length, 0);
  assert.equal(rows.filter((r: any) => r.schedule_id === ids[3]).length, 1);
  assert.ok(
    rows.every((r: any) => [owner, DEMO_USERS.client.id].includes(r.recipient)),
  );
  assert.match(
    rows.find((r: any) => r.schedule_id === ids[1]).message,
    /Сегодня/,
  );
  await service("select queue_buyer_reminders()");
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int as n from private.telegram_deliveries where schedule_id=any($1::uuid[])",
        [ids],
      )
    ).rows[0].n,
    rows.length,
  );
});

test("phone-only buyer opens an empty personal cabinet before profile or merchant selection", async () => {
  const user = randomUUID();
  const tg = 812345678901;
  await signup(user, tg);
  await as(user, "select buyer_request_phone()");
  await service("select telegram_verify_phone($1,$2,$3,$4)", [tg, "+79990000001", Math.floor(Date.now() / 1000), 912345]);
  const context = (await as(user, "select session_context() as v")).rows[0].v;
  assert.equal(context.role, "client");
  assert.equal(context.tenant_id, null);
  const profile = (await as(user, "select buyer_state() as v")).rows[0].v.profile;
  assert.ok(profile.phone_verified_at);
  assert.equal(profile.consent_at, null);
  const personal = await state(user);
  for (const key of ["customers", "applications", "contracts", "payments", "payment_schedules"])
    assert.deepEqual(personal[key], [], key + " must not expose another buyer's records");
  await assert.rejects(as(user, "select buyer_select($1)", [TENANT]));
});
