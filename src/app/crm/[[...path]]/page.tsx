import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { isDemo } from "@/lib/demo-db";
import type { State } from "@/lib/types";
import type { AccessState } from "@/components/platform-access";
import { CRM } from "@/components/crm";
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
    const { data: access, error } = await (
      await supabase()
    ).rpc("my_company_access");
    if (error) throw new Error("Не удалось проверить доступ");
    if (access && !access.allowed)
      return (
        <main className="mini-page">
          <section className="card pad">
            <h1>
              {access.status === "blocked"
                ? "Доступ приостановлен"
                : "Подписка закончилась"}
            </h1>
            <p>
              Заявки, договоры и история платежей сохранены. Для продления
              свяжитесь с владельцем HESAP.
            </p>
            <a
              className="btn btn-primary full mt"
              href="https://t.me/merlandzhe"
            >
              Написать владельцу HESAP
            </a>
          </section>
        </main>
      );
  }
  const { path = [] } = await params;
  if (!s.tenant_id && !s.platform_admin) redirect("/login");
  if (
    s.platform_admin &&
    !s.tenant_id &&
    ![
      "platform",
      "registry",
      "platform-customers",
      "platform-requests",
      "platform-notifications",
    ].includes(path[0])
  )
    redirect("/crm/platform");
  if (s.role !== "owner" && path[0] === "settings")
    return (
      <main className="legal">
        <h1>Доступ ограничен</h1>
        <p>Тарифы настраивает владелец организации.</p>
        <a href="/crm">Вернуться</a>
      </main>
    );
  // Platform-only screens use their own authorized directory endpoints;
  // they do not need any tenant's sales ledger.
  const platformOnly = s.platform_admin && !s.tenant_id;
  let initialAccess: AccessState | undefined;
  if (
    platformOnly &&
    !isDemo() &&
    ["platform", "platform-requests", "platform-notifications"].includes(
      path[0],
    )
  ) {
    const { data, error } = await (
      await supabase()
    ).rpc("platform_access_state");
    if (!error && data) initialAccess = data;
  }
  return (
    <CRM
      initialAccess={initialAccess}
      initial={platformOnly ? emptyPlatformState : await getState(s)}
      session={s}
      path={path}
      demo={isDemo()}
      telegram={telegramMiniAppEnabled()}
    />
  );
}

const emptyPlatformState: State = {
  organizations: [],
  customers: [],
  applications: [],
  purchases: [],
  documents: [],
  contracts: [],
  contract_items: [],
  contract_versions: [],
  payment_schedules: [],
  payments: [],
  payment_allocations: [],
  cash_accounts: [],
  cash_transactions: [],
  settings: [],
  notifications: [],
  audit_logs: [],
  members: [],
  subscriptions: [],
  payment_claims: [],
};
