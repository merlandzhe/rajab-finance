import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fail } from "@/lib/http";
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    if (!s.platform_admin) throw Error("FORBIDDEN");
    const url = new URL(req.url);
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw Error("INVALID_INPUT");
    const { data, error } = await (
      await supabase()
    ).rpc("platform_customer_directory", {
      p_query: (url.searchParams.get("q") || "").slice(0, 120),
      p_offset: offset,
      p_archived: url.searchParams.get("archived") === "true",
    });
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
