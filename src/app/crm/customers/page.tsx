import Link from "next/link";
import {redirect} from "next/navigation";
import {session} from "@/lib/auth";
import {getState} from "@/lib/repository";
import {isDemo} from "@/lib/demo-db";
import {supabase} from "@/lib/supabase";
import {PremiumCustomers} from "@/components/premium-customers";
import "./premium-customers.css";
export const dynamic="force-dynamic";
export default async function CustomersPage(){
 const s=await session();
 if(!s) redirect("/login");
 if(s.role==="client")redirect("/cabinet");
 if(!s.tenant_id||!["owner","manager","cashier"].includes(s.role||""))redirect("/crm");
 if(!isDemo()&&!s.platform_admin){
  const {data:access,error}=await(await supabase()).rpc("my_company_access");
  if(error)throw new Error("Не удалось проверить доступ к компании");
  if(access&&!access.allowed)return <main className="cx-denied"><h1>Доступ к компании приостановлен</h1><p>Сведения о клиентах сохранены.</p><Link href="/crm">Вернуться в кабинет</Link></main>;
 }
 const all=await getState(s);
 const customers=all.customers.filter(c=>c.tenant_id===s.tenant_id);
 return <PremiumCustomers customers={customers} contracts={all.contracts.filter(c=>c.tenant_id===s.tenant_id)} data={all}/>;
}