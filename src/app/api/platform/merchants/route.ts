import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase, serviceClient } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { inviteHash } from "@/lib/telegram-init";
import { telegramBotUsername } from "@/lib/telegram-config";
const input = z.union([
  z.object({ tenant_id: z.uuid() }).strict(),
  z.object({ owner_id: z.uuid() }).strict(),
  z
    .object({
      name: z.string().trim().min(2).max(120),
      owner_name: z.string().trim().min(2).max(120),
    })
    .strict(),
]);
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (!s.platform_admin) throw new Error("FORBIDDEN");
    await throttle(req, "merchant-invite:" + s.user_id, 10);
    const b = input.parse(await limitedJson(req));
    const code = randomBytes(32).toString("base64url");
    const client = await supabase();
    let result;
    if ("tenant_id" in b) {
      // Resolve only the requested organization's active owner, after the
      // platform-admin check. Never expose member rows to the client.
      const { data: owners, error } = await serviceClient()
        .from("organization_members")
        .select("user_id")
        .eq("tenant_id", b.tenant_id)
        .eq("role", "owner")
        .eq("active", true)
        .limit(2);
      if (error || owners?.length !== 1)
        throw new Error("Не удалось однозначно определить владельца кабинета");
      result = await client.rpc("platform_owner_invite", {
        p_owner: owners[0].user_id,
        p_hash: inviteHash(code),
      });
    } else if ("owner_id" in b)
      result = await client.rpc("platform_owner_invite", {
        p_owner: b.owner_id,
        p_hash: inviteHash(code),
      });
    else {
      const admin = serviceClient();
      const created = await admin.auth.admin.createUser({
        email: `merchant-${randomUUID()}@telegram.invalid`,
        email_confirm: true,
        app_metadata: { rajab_pending_merchant: true },
      });
      if (created.error) throw new Error("Не удалось создать кабинет");
      result = await client.rpc("platform_create_merchant", {
        p_user: created.data.user.id,
        p_name: b.name,
        p_owner: b.owner_name,
        p_hash: inviteHash(code),
      });
      if (result.error) {
        /* Only our freshly created, unassigned Auth account may be cleaned up. */ const {
          data: profile,
          error: check,
        } = await admin
          .from("profiles")
          .select("id")
          .eq("id", created.data.user.id)
          .maybeSingle();
        if (!check && !profile)
          await admin.auth.admin.deleteUser(created.data.user.id);
      }
    }
    if (result.error) throw result.error;
    return NextResponse.json(
      {
        ...result.data,
        code,
        url: `https://t.me/${telegramBotUsername()}?startapp=invite_${code}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
