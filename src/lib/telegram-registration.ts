import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// No password, deliverable email, or role selected by the browser. The reserved
// .invalid address is only an internal Auth identifier, never a recovery inbox.
export function telegramEmail(id: number) {
  return `tg-${createHash("sha256").update(`rajab-buyer:${id}`).digest("hex").slice(0, 48)}@telegram.invalid`;
}
export async function registerTelegramBuyer(
  admin: SupabaseClient,
  id: number,
  digest: string,
) {
  const email = telegramEmail(id);
  let lookup = await admin.rpc("telegram_signup_lookup", { p_email: email });
  if (lookup.error) throw lookup.error;
  let userId = lookup.data as string | null;
  if (!userId) {
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { rajab_telegram_buyer: true },
    });
    if (created.error) {
      // Concurrent/retried provisioning: recover only our server-marked account.
      lookup = await admin.rpc("telegram_signup_lookup", { p_email: email });
      if (lookup.error || !lookup.data)
        throw new Error("TELEGRAM_SESSION_FAILED");
      userId = lookup.data;
    } else userId = created.data.user.id;
  }
  const result = await admin.rpc("telegram_register_buyer", {
    p_telegram_id: id,
    p_digest: digest,
    p_user: userId,
    p_email: email,
  });
  if (result.error || typeof result.data !== "string")
    throw result.error ?? new Error("TELEGRAM_SESSION_FAILED");
  return result.data as string;
}
