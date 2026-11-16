import type { PGlite } from "@electric-sql/pglite";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoReceipt } from "./pdf";
import { DEMO_USERS, TENANT, OTHER_TENANT } from "./demo-ids";
import { addMonths, today } from "./money";
export const shim = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;
grant select on storage.objects to authenticated;
`;
export async function seed(db: PGlite) {
  for (const [key, u] of Object.entries(DEMO_USERS)) {
    await db.query("insert into auth.users(id) values($1)", [u.id]);
    await db.query(
      "insert into profiles(id,display_name,platform_admin) values($1,$2,$3)",
      [u.id, u.name, key === "platform"],
    );
  }
  for (const [id, name, slug] of [
    [TENANT, "RAJAB FINANCE", "rajab"],
    [OTHER_TENANT, "Тестовая организация Б", "other"],
  ]) {
    await db.query("insert into organizations(id,name,slug) values($1,$2,$3)", [
      id,
      name,
      slug,
    ]);
    await db.query(
      'insert into organization_settings(tenant_id,version,mode,fixed_bps,term_rates) values($1,1,\'term\',1800,\'{"3":600,"6":1200,"9":1800,"12":2400}\')',
      [id],
    );
    await db.query(
      "insert into document_templates(tenant_id,version,name) values($1,1,'Демонстрационный договор v1')",
      [id],
    );
  }
  for (const [key, u] of Object.entries(DEMO_USERS))
    if (key !== "platform" && key !== "buyer")
      await db.query(
        "insert into organization_members(tenant_id,user_id,role) values($1,$2,$3)",
        [key === "other" ? OTHER_TENANT : TENANT, u.id, u.role],
      );
  await seedBuyerDemo(db);
  const owner = DEMO_USERS.owner.id;
  const customers: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = randomUUID();
    customers.push(id);
    await db.query(
      "insert into customers(id,tenant_id,auth_user_id,name,phone,email,notes) values($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        TENANT,
        i === 0 ? DEMO_USERS.client.id : null,
        `Демо Клиент ${String(i + 1).padStart(2, "0")}`,
        `+7 000 000 00 0${i + 1}`,
        `client${i + 1}@example.invalid`,
        "Вымышленная карточка для проверки CRM",
      ],
    );
  }
  await db.query(
    "insert into customers(tenant_id,name,phone) values($1,'Клиент другой организации','+7 000 000 99 99')",
    [OTHER_TENANT],
  );
  const cash = randomUUID();
  const bank = randomUUID();
  await db.query(
    "insert into cash_accounts(id,tenant_id,name) values($1,$2,'Основная касса'),($3,$2,'Расчётный счёт')",
    [cash, TENANT, bank],
  );
  await db.query(
    "insert into cash_accounts(tenant_id,name) values($1,'Касса Б')",
    [OTHER_TENANT],
  );
  const goods = [
    "Ноутбук для работы",
    "Холодильник Samsung",
    "Смартфон 256 ГБ",
    "Мебель для гостиной",
    "Стиральная машина",
    "Комплект техники",
  ];
  const costs = [12000000, 7800000, 9600000, 18400000, 5400000, 21000000];
  for (let i = 0; i < 6; i++) {
    const a = randomUUID(),
      p = randomUUID(),
      d = randomUUID(),
      c = randomUUID();
    const cost = costs[i],
      profit = Math.round(cost * 0.12),
      price = cost + profit,
      down = cost / 5; // Exact integer seed fixtures; production calculations are SQL NUMERIC/Decimal.
    const signed = addMonths(today(), -3);
    const first = addMonths(signed, 1);
    const each = Math.floor((price - down) / 6);
    await db.query(
      "insert into applications(id,tenant_id,customer_id,product_name,supplier,estimated_cost,down_payment,months,status,created_by) values($1,$2,$3,$4,'Демо поставщик',$5,$6,6,'contracted',$7)",
      [a, TENANT, customers[i], goods[i], cost, down, owner],
    );
    const receipt = await demoReceipt(goods[i], String(cost));
    const filePath = path.join(".demo/files", TENANT, a, d + ".pdf");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, receipt);
    await db.query(
      "insert into documents(id,tenant_id,application_id,kind,name,storage_path,mime_type,size_bytes,sha256,created_by) values($1,$2,$3,'purchase_receipt','Демо-документ закупки.pdf',$4,'application/pdf',$7,$5,$6)",
      [
        d,
        TENANT,
        a,
        `${TENANT}/${a}/${d}.pdf`,
        createHash("sha256").update(receipt).digest("hex"),
        owner,
        receipt.byteLength,
      ],
    );
    await db.query(
      "insert into purchases(id,tenant_id,application_id,supplier,cost,purchased_on,ownership_confirmed,document_id,created_by) values($1,$2,$3,'Демо поставщик',$4,$5,true,$6,$7)",
      [p, TENANT, a, cost, signed, d, owner],
    );
    await db.query(
      "insert into contracts(id,tenant_id,customer_id,application_id,purchase_id,number,signed_on,cost,profit,sale_price,down_payment,months,first_payment_on,status,transferred_on,transfer_reference,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,6,$12,'transferred',$7,'Демонстрационный акт передачи',$13)",
      [
        c,
        TENANT,
        customers[i],
        a,
        p,
        `RF-26-000${i + 1}`,
        signed,
        cost,
        profit,
        price,
        down,
        first,
        owner,
      ],
    );
    await db.query(
      "insert into contract_items(tenant_id,contract_id,product_name,cost) values($1,$2,$3,$4)",
      [TENANT, c, goods[i], cost],
    );
    await db.query(
      "insert into contract_versions(tenant_id,contract_id,snapshot) values($1,$2,$3)",
      [
        TENANT,
        c,
        JSON.stringify({
          product_name: goods[i],
          customer_name: `Демо Клиент ${String(i + 1).padStart(2, "0")}`,
          seller_name: "RAJAB FINANCE",
          cost: String(cost),
          profit: String(profit),
          sale_price: String(price),
          down_payment: String(down),
          months: 6,
          settings_version: 1,
          pricing_mode: "term",
          template_version: 1,
          legal_notice: "Не является юридически утверждённым договором",
        }),
      ],
    );
    for (let j = 0; j <= 6; j++)
      await db.query(
        "insert into payment_schedules(tenant_id,contract_id,sequence,due_on,amount) values($1,$2,$3,$4,$5)",
        [
          TENANT,
          c,
          j,
          j === 0 ? signed : addMonths(first, j - 1),
          j === 0 ? down : j === 6 ? price - down - each * 5 : each,
        ],
      );
    for (let j = 0; j < (i === 2 ? 2 : 4); j++) {
      const paid = j === 0 ? down : each;
      await db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          owner,
        ]);
        await tx.query("select app_command($1,$2::jsonb,$3::uuid)", [
          "payment.record",
          JSON.stringify({
            contract_id: c,
            cash_account_id: i % 2 ? bank : cash,
            amount: String(paid),
            paid_on: j === 0 ? signed : addMonths(first, j - 1),
          }),
          randomUUID(),
        ]);
      });
    }
  }
  for (let i = 0; i < 3; i++)
    await db.query(
      "insert into applications(tenant_id,customer_id,product_name,supplier,estimated_cost,down_payment,months,status,created_by) values($1,$2,$3,'Демо поставщик',$4,0,6,$5,$6)",
      [
        TENANT,
        customers[i],
        ["MacBook Air 13", "Диван и два кресла", "Техника для кухни"][i],
        [14800000, 9200000, 6400000][i],
        ["review", "approved", "awaiting_purchase"][i],
        owner,
      ],
    );
}

// Local-only fixture. Hosted registration never calls seed()/seedBuyerDemo().
export async function seedBuyerDemo(db: PGlite) {
  const u = DEMO_USERS.buyer;
  await db.query(
    "insert into auth.users(id) values($1) on conflict do nothing",
    [u.id],
  );
  await db.query(
    "insert into profiles(id,display_name) values($1,$2) on conflict do nothing",
    [u.id, u.name],
  );
  await db.query(
    "insert into buyer_profiles(user_id,phone,phone_verified_at) values($1,'+70000000000',now()) on conflict do nothing",
    [u.id],
  );
  await db.query(
    "insert into seller_directory(tenant_id,display_name,enabled) values($1,'Раджап · тестовые данные',true),($2,'Продавец Б · тестовые данные',true) on conflict do nothing",
    [TENANT, OTHER_TENANT],
  );
}
