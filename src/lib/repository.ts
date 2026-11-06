import "server-only";
import { supabase, serviceClient } from "./supabase";
import type { Session, State } from "./types";

export async function getState(s: Session): Promise<State> {
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
  const { data, error } = await (
    await supabase()
  ).rpc(rpc, { p_action: action, p_payload: payload, p_key: key });
  if (error) throw error;
  return data;
}
export async function rateLimit(key: string, limit = 60, seconds = 60) {
  const { data, error } = await serviceClient().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error) throw new Error("Сервис временно недоступен");
  return data === true;
}
