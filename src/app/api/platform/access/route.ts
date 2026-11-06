import { randomBytes } from "node:crypto";
import { NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { platformInput } from "@/lib/merchant-input";
import { inviteHash } from "@/lib/telegram-init";
import { deliverAfterCommand } from "@/lib/notification-delivery";
export async function GET() {
  try {
    const s = await requireSession();
    if (!s.platform_admin) throw Error("FORBIDDEN");
    const { data, error } = await (
      await supabase()
    ).rpc("platform_access_state");
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await requireSession();
    if (!s.platform_admin) throw Error("FORBIDDEN");
    await throttle(req, "platform-access:" + s.user_id, 30);
    const b = platformInput.parse(await limitedJson(req)),
      db = await supabase();
    let result;
    let code: string | undefined;
    if (b.action === "issue") {
      code = randomBytes(32).toString("base64url");
      result = await db.rpc("platform_issue_code", {
        p_request: b.id,
        p_hash: inviteHash(code),
        p_days: b.days,
      });
    } else if (b.action === "revoke")
      result = await db.rpc("platform_revoke_code", { p_id: b.id });
    else if (b.action === "status")
      result = await db.rpc("platform_request_status", {
        p_id: b.id,
        p_status: b.status,
      });
    else if (b.action === "access")
      result = await db.rpc("platform_company_access", {
        p_tenant: b.tenant_id,
        p_status: b.status,
        p_expires: b.expires_at,
      });
    else if (b.action === "revoke_legacy")
      result = await db.rpc("platform_revoke_legacy", {
        p_tenant: b.tenant_id,
      });
    else {
      result = await db.rpc("platform_retry_delivery");
      after(deliverAfterCommand);
    }
    if (result.error) throw result.error;
    return NextResponse.json(
      { ...result.data, ok: true, ...(code ? { code } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
