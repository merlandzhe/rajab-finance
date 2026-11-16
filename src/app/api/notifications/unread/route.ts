import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail } from "@/lib/http";

export const runtime = "nodejs";
const EPOCH = "1970-01-01T00:00:00.000Z";
const headers = { "Cache-Control": "private, no-store" };
const allowed = new Set(["owner", "manager", "cashier"]);

async function context() {
  const session = await requireSession();
  if (!session.tenant_id || !session.role || !allowed.has(session.role))
    throw Error("FORBIDDEN");
  return { session, db: await supabase() };
}

export async function GET() {
  try {
    const { session, db } = await context();
    const state = await db.from("notification_read_state")
      .select("last_read_at")
      .eq("user_id", session.user_id)
      .eq("tenant_id", session.tenant_id!)
      .maybeSingle();
    if (state.error) throw state.error;
    const since = state.data?.last_read_at ?? EPOCH;
    const pending = await db.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenant_id!)
      .gt("created_at", since);
    if (pending.error) throw pending.error;
    return NextResponse.json({ count: pending.count ?? 0 }, { headers });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { session, db } = await context();
    const latest = await db.from("notifications")
      .select("created_at")
      .eq("tenant_id", session.tenant_id!)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw latest.error;

    if (latest.data) {
      const prior = await db.from("notification_read_state")
        .select("last_read_at")
        .eq("user_id", session.user_id)
        .eq("tenant_id", session.tenant_id!)
        .maybeSingle();
      if (prior.error) throw prior.error;
      const lastRead = prior.data?.last_read_at;
      const lastSeenAt =
        lastRead && lastRead > latest.data.created_at
          ? lastRead
          : latest.data.created_at;
      const saved = await db.from("notification_read_state").upsert({
        user_id: session.user_id,
        tenant_id: session.tenant_id!,
        last_read_at: lastSeenAt,
      }, { onConflict: "user_id,tenant_id" });
      if (saved.error) throw saved.error;
    }

    const pending = await db.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenant_id!)
      .gt("created_at", latest.data?.created_at ?? EPOCH);
    if (pending.error) throw pending.error;
    return NextResponse.json({ count: pending.count ?? 0 }, { headers });
  } catch (error) {
    return fail(error);
  }
}
