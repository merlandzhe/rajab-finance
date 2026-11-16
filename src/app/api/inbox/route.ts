import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const form = z.object({ scope: z.enum(["buyer","platform"]), before: z.string().max(40) }).strict();
type Scope = "buyer" | "platform";
async function identify(scope: Scope) {
  const s = await requireSession();
  if (scope === "buyer" && s.role !== "client") throw Error("FORBIDDEN");
  if (scope === "platform" && !s.platform_admin) throw Error("FORBIDDEN");
  return { db: await supabase(), user: s.user_id };
}
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("scope");
    if (q !== "buyer" && q !== "platform") throw Error("FORBIDDEN");
    const { db, user } = await identify(q);
    const feed = await db.from("in_app_notifications")
      .select("id,kind,title,body,href,created_at,read_at")
      .eq("recipient_user_id",user).eq("scope",q)
      .order("created_at",{ascending:false}).limit(40);
    if (feed.error) throw feed.error;
    const unread = await db.from("in_app_notifications")
      .select("id",{count:"exact",head:true})
      .eq("recipient_user_id",user).eq("scope",q).is("read_at",null);
    if (unread.error) throw unread.error;
    return NextResponse.json({
      items: feed.data ?? [], unread: unread.count ?? 0,
      before: feed.data?.[0]?.created_at ?? null
    },{headers});
  } catch(e) {return fail(e);}
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p=form.parse(await limitedJson(request));
    const before=new Date(p.before);
    if(!Number.isFinite(before.getTime())) throw Error("INVALID_DATE");
    const {db,user}=await identify(p.scope);
    await throttle(request,"inbox:"+user,25);
    const saved=await db.from("in_app_notifications")
      .update({read_at:new Date().toISOString()})
      .eq("recipient_user_id",user).eq("scope",p.scope)
      .is("read_at",null).lte("created_at",before.toISOString());
    if(saved.error)throw saved.error;
    const count=await db.from("in_app_notifications")
      .select("id",{count:"exact",head:true})
      .eq("recipient_user_id",user).eq("scope",p.scope).is("read_at",null);
    if(count.error)throw count.error;
    return NextResponse.json({unread:count.count??0},{headers});
  }catch(e){return fail(e);}
}
