import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fail } from "@/lib/http";
export async function GET() {
  try {
    const s = await requireSession();
    if (s.role !== "owner") throw new Error("FORBIDDEN");
    const { data, error } = await (await supabase()).rpc("notification_health");
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
