import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "./types";

// The privileged client resolves an already-linked Auth account only. Normal
// CRM queries still use the user's Supabase session and existing RLS policies.
export async function establishTelegramSession(
  userId: string,
  admin: SupabaseClient,
  client: SupabaseClient,
) {
  const account = await admin.auth.admin.getUserById(userId);
  if (
    account.error ||
    account.data.user?.id !== userId ||
    !account.data.user.email
  )
    throw new Error("TELEGRAM_SESSION_FAILED");
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: account.data.user.email,
  });
  // generateLink can create users. Never authenticate a different/new account
  // if the email changed between lookup and link generation.
  if (
    link.error ||
    link.data.user?.id !== userId ||
    !link.data.properties?.hashed_token
  )
    throw new Error("TELEGRAM_SESSION_FAILED");
  const result = await client.auth.verifyOtp({
    type: "email",
    token_hash: link.data.properties.hashed_token,
  });
  if (result.error || result.data.user?.id !== userId || !result.data.session) {
    await client.auth.signOut({ scope: "local" });
    throw new Error("TELEGRAM_SESSION_FAILED");
  }
  const context = await client.rpc("session_context");
  const s = context.data as Session | null;
  if (
    context.error ||
    s?.user_id !== userId ||
    (!s.role && !s.platform_admin)
  ) {
    await client.auth.signOut({ scope: "local" });
    throw new Error("FORBIDDEN");
  }
  return s.role === "client"
    ? "/cabinet"
    : s.platform_admin && !s.tenant_id
      ? "/crm/platform"
      : "/crm";
}
