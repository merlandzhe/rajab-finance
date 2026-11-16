import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { isDemo } from "@/lib/demo-db";
import { getState } from "@/lib/repository";
import { supabase } from "@/lib/supabase";
import { MerchantManualSale } from "@/components/merchant-manual-sale";
import "./manual-sale.css";
import "./manual-paid.css";
export const dynamic = "force-dynamic";
export default async function NewCustomerPage() {
 const s=await session();
 if(!s) redirect("/login");
 if(!s.tenant_id || (s.role!=="owner"&&s.role!=="manager")) redirect("/crm");
 if(!isDemo()){
  const {data:access,error}=await (await supabase()).rpc("my_company_access");
  if(error)throw Error("Не удалось проверить доступ компании");
  if(access&&!access.allowed) return <main className="ms-locked">
   <h1>Доступ к магазину приостановлен</h1>
   <p>Клиенты и договоры сохранены. Для продления свяжитесь с владельцем HESAP.</p>
   <Link href="/crm">Вернуться в кабинет</Link>
  </main>;
 }
 const data=await getState(s);
 return <MerchantManualSale settings={data.settings[0]??null}/>;
}
