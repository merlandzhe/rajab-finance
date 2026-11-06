import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { deliverAfterCommand } from "@/lib/notification-delivery";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("search"),
      phone: z.string().min(11).max(25),
      purpose: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("add"),
      contract_id: z.string().uuid(),
      basis: z.string().trim().min(5).max(200),
      confirm: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(["withdraw", "dispute"]),
      id: z.string().uuid(),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
]);
export async function GET() {
  try {
    const s = await requireSession();
    if (s.role !== "owner" && !s.platform_admin) throw new Error("FORBIDDEN");
    const { data, error } = await (
      await supabase()
    ).rpc("overdue_registry_state");
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
    await throttle(req, "registry:" + s.user_id, 20);
    const b = input.parse(await limitedJson(req)),
      db = await supabase();
    let result;
    if (b.action === "search")
      result = await db.rpc("overdue_registry_state", { p_phone: b.phone });
    else if (b.action === "add")
      result = await db.rpc("overdue_registry_add", {
        p_contract: b.contract_id,
        p_basis: b.basis,
        p_confirm: b.confirm,
      });
    else
      result = await db.rpc("overdue_registry_change", {
        p_id: b.id,
        p_action: b.action,
        p_reason: b.reason,
      });
    if (result.error) throw result.error;
    if (b.action !== "search") after(deliverAfterCommand);
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
