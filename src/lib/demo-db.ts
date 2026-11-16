import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { seed, shim, seedBuyerDemo } from "./seed";
const g = globalThis as unknown as { rajabDb?: Promise<PGlite> };
export function isDemo() {
  return process.env.DEMO_MODE === "true" && !process.env.VERCEL;
}
export function demoDb() {
  if (!isDemo()) throw new Error("Локальный деморежим выключен");
  if (!g.rajabDb)
    g.rajabDb = (async () => {
      const dir = path.join(process.cwd(), ".demo");
      await mkdir(dir, { recursive: true });
      const db = new PGlite(path.join(dir, "postgres"));
      await db.waitReady;
      await db.exec("set timezone='Europe/Moscow'");
      const exists = await db.query(
        "select to_regclass('public.organizations') as existing",
      );
      if (!(exists.rows[0] as { existing: unknown }).existing) {
        await db.transaction(async (tx) => {
          await tx.exec(shim);
          for (const f of (await readdir("supabase/migrations")).sort())
            if (f.endsWith(".sql"))
              await tx.exec(
                await readFile(path.join("supabase/migrations", f), "utf8"),
              );
        });
        await seed(db);
      }
      // Upgrade earlier local demos without touching any hosted database.
      const portal = await db.query(
        "select to_regclass('public.payment_claims') as existing",
      );
      if (!(portal.rows[0] as { existing: unknown }).existing) {
        await db.transaction(async (tx) => {
          await tx.exec(
            await readFile(
              "supabase/migrations/20261015141557_client_portal.sql",
              "utf8",
            ),
          );
        });
      }
      const buyer = await db.query(
        "select to_regclass('public.buyer_profiles') as existing",
      );
      if (!(buyer.rows[0] as { existing: unknown }).existing) {
        await db.transaction(async (tx) => {
          await tx.exec(
            "alter table auth.users add column if not exists email text; alter table auth.users add column if not exists raw_app_meta_data jsonb not null default '{}'",
          );
          const tg = await tx.query(
            "select to_regclass('private.telegram_accounts') as existing",
          );
          if (!(tg.rows[0] as { existing: unknown }).existing)
            await tx.exec(
              await readFile(
                "supabase/migrations/20261015144047_telegram_mini_app.sql",
                "utf8",
              ),
            );
          await tx.exec(
            await readFile(
              "supabase/migrations/20261016140916_buyer_platform.sql",
              "utf8",
            ),
          );
        });
      }
      const paymentMethods = await db.query(
        "select to_regclass('public.seller_payment_methods') as existing",
      );
      if (!(paymentMethods.rows[0] as { existing: unknown }).existing) {
        await db.transaction(async (tx) => {
          await tx.exec(
            await readFile("supabase/pending/premium_cabinets.sql", "utf8"),
          );
        });
      }
      await seedBuyerDemo(db);
      return db;
    })();
  return g.rajabDb;
}
export async function demoRpc<T>(
  userId: string | null,
  name: string,
  args: unknown[] = [],
): Promise<T> {
  const db = await demoDb();
  const allowed = [
    "buyer_state",
    "buyer_request_phone",
    "buyer_profile_save",
    "buyer_select",
    "notification_health",
    "app_state",
    "session_context",
    "app_command",
    "portal_command",
    "public_terms",
    "save_seller_payment_methods",
  ];
  if (!allowed.includes(name)) throw new Error("Unknown RPC");
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId ?? "",
    ]);
    const q = await tx.query<{ value: T }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
      args,
    );
    return q.rows[0].value;
  });
}
