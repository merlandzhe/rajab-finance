import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isDemo } from "@/lib/demo-db";
import { MerchantNotificationSettings } from "@/components/merchant-notification-settings";
import "./notifications-settings.css";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await session();
  if (!user) redirect("/login");
  if (user.role === "client") redirect("/cabinet");
  if (!user.tenant_id || !["owner", "manager", "cashier"].includes(user.role || ""))
    redirect("/crm");

  if (!isDemo()) {
    const { data: access, error } = await (await supabase()).rpc("my_company_access");
    if (error) throw Error("Не удалось проверить доступ к магазину");
    if (access && !access.allowed) return <main className="mns-restricted">
      <h1>Доступ приостановлен</h1>
      <p>Настройки уведомлений сохранятся после восстановления доступа.</p>
      <Link href="/crm">Вернуться в кабинет</Link>
    </main>;
  }
  return <MerchantNotificationSettings />;
}
