import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { isDemo } from "@/lib/demo-db";
import { supabase } from "@/lib/supabase";
import { MerchantPaymentCalendar } from "@/components/merchant-payment-calendar";
import "./calendar.css";
export const dynamic = "force-dynamic";
export default async function MerchantCalendarPage() {
  const s = await session();
  if (!s) redirect("/login");
  if (s.role === "client") redirect("/cabinet");
  if (!s.tenant_id || !["owner","manager","cashier"].includes(s.role || "")) redirect("/crm");
  if (!isDemo()) {
    const { data: access, error } = await (await supabase()).rpc("my_company_access");
    if (error) throw new Error("Не удалось проверить доступ компании");
    if (access && !access.allowed) {
      return <main className="pc-locked">
        <h1>Доступ к компании приостановлен</h1>
        <p>Данные платежей сохранены. Для восстановления свяжитесь с владельцем HESAP.</p>
        <Link href="/crm">Вернуться в кабинет</Link>
      </main>;
    }
  }
  const data = await getState(s);
  return <MerchantPaymentCalendar data={data}/>;
}
