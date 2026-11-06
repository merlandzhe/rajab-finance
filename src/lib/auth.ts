import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isDemo, demoRpc } from "./demo-db";
import { supabase } from "./supabase";
import { DEMO_USERS } from "./demo-ids";
import type { Session } from "./types";
let secret: Uint8Array | undefined;
async function demoSecret() {
  if (secret) return secret;
  await mkdir(".demo", { recursive: true });
  try {
    secret = await readFile(".demo/session-key");
  } catch {
    const bytes = randomBytes(32);
    try {
      await writeFile(".demo/session-key", bytes, { flag: "wx", mode: 0o600 });
    } catch {}
    secret = await readFile(".demo/session-key");
  }
  return secret;
}
export async function demoLogin(key: keyof typeof DEMO_USERS) {
  if (!isDemo() || !DEMO_USERS[key]) throw new Error("Демо недоступно");
  const token = await new SignJWT({ sub: DEMO_USERS[key].id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("4h")
    .setIssuer("rajab-local-demo")
    .setAudience("rajab-local-demo")
    .sign(await demoSecret());
  (await cookies()).set("rajab_demo", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 14400,
    path: "/",
  });
}
export async function session(): Promise<Session | null> {
  if (isDemo()) {
    const token = (await cookies()).get("rajab_demo")?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, await demoSecret(), {
        issuer: "rajab-local-demo",
        audience: "rajab-local-demo",
        algorithms: ["HS256"],
      });
      if (!payload.sub) return null;
      return await demoRpc<Session>(payload.sub, "session_context");
    } catch {
      return null;
    }
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const client = await supabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const ctx = await client.rpc("session_context");
  if (ctx.error) return null;
  return ctx.data as Session;
}
export async function requireSession() {
  const s = await session();
  if (!s?.user_id) throw new Error("AUTH_REQUIRED");
  return s;
}
