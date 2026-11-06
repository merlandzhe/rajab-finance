import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { seed, shim } from "../tests/fixtures/seed";
const db = new PGlite();
await db.waitReady;
await db.exec(shim);
for (const f of (await readdir("supabase/migrations")).sort()) {
  await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  console.log("migration OK", f);
}
await seed(db);
console.log("seed OK");
await db.close();
