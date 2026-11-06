import "server-only";
import { supabase } from "./supabase";
import type { Session } from "./types";

export async function session(): Promise<Session | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const client = await supabase();
  const [identity, ctx] = await Promise.all([
    client.auth.getUser(),
    client.rpc("session_context"),
  ]);
  if (identity.error || !identity.data.user || ctx.error ||
      ctx.data?.user_id !== identity.data.user.id) return null;
  return ctx.data as Session;
}
export async function requireSession() {
  const s = await session();
  if (!s?.user_id) throw new Error("AUTH_REQUIRED");
  return s;
}
