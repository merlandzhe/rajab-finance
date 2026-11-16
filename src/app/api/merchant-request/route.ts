import { NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
import { merchantRequestInput } from "@/lib/merchant-input";
import { deliverAfterCommand } from "@/lib/notification-delivery";
export async function GET() {
  try {
    const s = await requireSession();
    const { data, error } = await (
      await supabase()
    )
      .from("merchant_requests")
      .select("id,shop_name,status,created_at")
      .eq("user_id", s.user_id)
      .maybeSingle();
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
    await throttle(req, "merchant-request:" + s.user_id, 5, 3600);
    const b = merchantRequestInput.parse(await limitedJson(req));
    const { data, error } = await (
      await supabase()
    ).rpc("merchant_request_submit", {
      p_name: b.name,
      p_shop: b.shop_name,
      p_city: b.city,
      p_phone: b.phone,
    });
    if (error) throw error;
    after(deliverAfterCommand);
    return NextResponse.json(
      { id: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
