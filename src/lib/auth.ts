import "server-only";
import { supabase } from "./supabase";
import type { Session } from "./types";

export async function session(): Promise<Session | null> {
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
