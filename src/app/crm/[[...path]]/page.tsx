import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { isDemo } from "@/lib/demo-db";
import { CRM } from "@/components/crm";
import { DirectDealPage } from "@/components/direct-deal-page";
import { telegramMiniAppEnabled } from "@/lib/telegram-config";
import { supabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const s = await session();
  if (!s) redirect("/login");
  if (s.role === "client") redirect("/cabinet");
  if (!isDemo() && !s.platform_admin) {
    const { data: access, error } = await (await supabase()).rpc("my_company_access");
    if (error) throw new Error("Не удалось проверить доступ");
    if (access && !access.allowed)
      return (
        <main className="mini-page">
          <section className="card pad">
            <h1>{access.status === "blocked" ? "Доступ приостановлен" : "Подписка закончилась"}</h1>
            <p>Заявки, договоры и история платежей сохранены. Для продления свяжитесь с владельцем HESAP.</p>
            <a className="btn btn-primary full mt" href="https://t.me/merlandzhe">Написать владельцу HESAP</a>
          </section>
        </main>
      );
  }
  const { path = [] } = await params;
  if (!s.tenant_id && !s.platform_admin) redirect("/login");
  if (
    s.platform_admin &&
    !s.tenant_id &&
    !["platform", "registry", "platform-customers", "platform-requests", "platform-notifications"].includes(path[0])
  ) redirect("/crm/platform");
  if (s.role !== "owner" && path[0] === "settings")
    return <main className="legal"><h1>Доступ ограничен</h1><p>Тарифы настраивает владелец организации.</p><a href="/crm">Вернуться</a></main>;
  if (path[0] === "calculator" && (s.role === "owner" || s.role === "manager"))
    redirect("/crm/applications/new");
  const state = await getState(s);
  if (path[0] === "applications" && path[1] && (s.role === "owner" || s.role === "manager"))
    return <DirectDealPage data={state} id={path[1]} isNew={path[1] === "new"} />;
  if (path[0] === "contracts" && path[1] && (s.role === "owner" || s.role === "manager")) {
    const contract = state.contracts.find(c => c.id === path[1]);
    if (contract?.status === "awaiting_acceptance")
      return <DirectDealPage data={state} id={contract.application_id} isNew={false} />;
  }
  return (
    <CRM initial={state} session={s} path={path} demo={isDemo()} telegram={telegramMiniAppEnabled()} />
  );
}
