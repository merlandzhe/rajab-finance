import {redirect} from "next/navigation";
import {session} from "@/lib/auth";
import {getState} from "@/lib/repository";
import {isDemo} from "@/lib/demo-db";
import {supabase} from "@/lib/supabase";
import {CRM} from "@/components/crm";
export const dynamic="force-dynamic";
export default async function LegacyCustomerPage(){
 const s=await session();
 if(!s)redirect("/login");
 if(s.role==="client")redirect("/cabinet");
 if(!s.tenant_id||!["owner","manager","cashier"].includes(s.role||""))redirect("/crm");
 if(!isDemo()&&!s.platform_admin){
  const {data:access,error}=await(await supabase()).rpc("my_company_access");
  if(error)throw new Error("Не удалось проверить доступ к компании");
  if(access&&!access.allowed)redirect("/crm");
 }
 return <CRM initial={await getState(s)} session={s} path={["customers"]} demo={isDemo()}/>;
}