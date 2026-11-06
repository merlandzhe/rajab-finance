import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { supabase } from "@/lib/supabase";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("phone") }).strict(),
  z
    .object({
      action: z.literal("profile"),
      name: z.string().trim().min(2).max(120),
      city: z.string().trim().min(2).max(120),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal("select"), tenant_id: z.uuid() }).strict(),
]);
async function call(
  _user: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await (await supabase()).rpc(name, args);
  if (error) throw error;
  return data;
}
export async function GET() {
  try {
    const s = await requireSession();
    return NextResponse.json(await call(s.user_id, "buyer_state"), {
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
    if (s.role !== "client") throw new Error("FORBIDDEN");
    await throttle(req, "buyer:" + s.user_id, 30);
    const body = input.parse(await limitedJson(req));
    const data =
      body.action === "phone"
        ? await call(s.user_id, "buyer_request_phone")
        : body.action === "select"
          ? await call(s.user_id, "buyer_select", { p_tenant: body.tenant_id })
          : await call(s.user_id, "buyer_profile_save", {
              p_name: body.name,
              p_city: body.city,
              p_consent: body.consent,
            });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
