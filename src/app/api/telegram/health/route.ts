import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fail } from "@/lib/http";
import { isDemo, demoRpc } from "@/lib/demo-db";
export async function GET() {
  try {
    const s = await requireSession();
    if (s.role !== "owner") throw new Error("FORBIDDEN");
    if (isDemo())
      return NextResponse.json(await demoRpc(s.user_id, "notification_health"));
    const { data, error } = await (await supabase()).rpc("notification_health");
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
