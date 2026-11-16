import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { assertOrigin, fail, limitedJson, throttle } from "@/lib/http";
export const runtime = "nodejs";
const money = z.string().regex(/^\d{1,12}$/);
const shape = z.object({
  key: z.uuid(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(24),
  product: z.string().trim().min(2).max(160),
  cost: money, down: money,
  markupBps: z.number().int().min(0).max(10000),
  months: z.number().int().min(1).max(36),
  firstDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  soldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paidSteps: z.array(z.number().int().min(1).max(36)).max(36)
    .refine(v=>new Set(v).size===v.length,"Повторный номер платежа"),
  paidDown: z.boolean(),
  pastMethod: z.enum(["Наличные","СБП"]),
  offlineSigned: z.literal(true),
}).strict();
function validDate(s:string){const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime()) && d.toISOString().startsWith(s);}
export async function POST(request:Request) {
  try {
    assertOrigin(request);
    const session=await requireSession();
    if(!session.tenant_id || !["owner","manager"].includes(session.role??""))throw Error("FORBIDDEN");
    await throttle(request,"manual-sale:"+session.user_id,15);
    const payload=shape.parse(await limitedJson(request));
    if(!validDate(payload.firstDue)||!validDate(payload.soldOn))throw Error("INVALID_DATE");
    if(payload.paidSteps.some(step=>step>payload.months))throw Error("INVALID_PAYMENT_SEQUENCE");
    const { data,error }=await (await supabase()).rpc("create_manual_installment_with_history",{
      p_key:payload.key,p_customer_name:payload.name,p_customer_phone:payload.phone,
      p_product_name:payload.product,p_cost:payload.cost,p_markup_bps:payload.markupBps,
      p_down:payload.down,p_months:payload.months,p_first_due:payload.firstDue,
      p_signed_on:payload.soldOn,p_paid_steps:payload.paidSteps,
      p_paid_down:payload.paidDown,p_paid_method:payload.pastMethod,p_offline_signed:true,
    });
    if(error)throw error;
    return NextResponse.json(data,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return fail(error);}
}
