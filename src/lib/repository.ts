import "server-only";
import { demoDb, demoRpc, isDemo } from "./demo-db";
import { supabase, serviceClient } from "./supabase";
import type { Session, State } from "./types";
import { TENANT } from "./demo-ids";
import { DEMO_PRICING, type Pricing } from "./money";
export async function getState(s: Session): Promise<State> {
  if (isDemo()) return demoRpc<State>(s.user_id, "app_state");
  const { data, error } = await (await supabase()).rpc("app_state");
  if (error) throw error;
  return data as State;
}
export async function command(
  s: Session,
  action: string,
  payload: unknown,
  key: string,
) {
  const portal = action.startsWith("portal.");
  if (!s.tenant_id || (s.role === "client" && !portal))
    throw new Error("FORBIDDEN");
  const rpc = portal ? "portal_command" : "app_command";
  if (isDemo())
    return demoRpc<{ id: string; ok: boolean }>(s.user_id, rpc, [
      action,
      JSON.stringify(payload),
      key,
    ]);
  const { data, error } = await (
    await supabase()
  ).rpc(rpc, { p_action: action, p_payload: payload, p_key: key });
  if (error) throw error;
  return data;
}
export async function publicPricing(): Promise<Pricing> {
  if (isDemo())
    return (
      (await demoRpc<Pricing | null>(null, "public_terms", [TENANT])) ??
      DEMO_PRICING
    );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.PUBLIC_TENANT_ID)
    return DEMO_PRICING;
  const { data, error } = await (
    await supabase()
  ).rpc("public_terms", { p_tenant: process.env.PUBLIC_TENANT_ID });
  if (error) throw error;
  return data ?? DEMO_PRICING;
}
export async function rateLimit(key: string, limit = 60, seconds = 60) {
  if (isDemo()) {
    const db = await demoDb();
    const q = await db.query<{ ok: boolean }>(
      "select public.consume_rate_limit($1,$2,$3) as ok",
      [key, limit, seconds],
    );
    return q.rows[0].ok;
  }
  const { data, error } = await serviceClient().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error) throw new Error("Сервис временно недоступен");
  return data === true;
}
