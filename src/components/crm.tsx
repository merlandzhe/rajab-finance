"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutDashboard,
  Users,
  FileText,
  Wallet,
  Settings,
  ChartNoAxesCombined,
  LogOut,
  Bell,
  ChevronRight,
  ShoppingBag,
  ShieldCheck,
  Clock,
  Check,
  PackageCheck,
  Upload,
  Download,
  Search,
  CircleDollarSign,
  CalendarDays,
  Activity,
  Building2,
  Ellipsis,
  X,
  RefreshCw,
} from "lucide-react";
import { Brand } from "./brand";
import { matchesSearch, scheduleOverview } from "@/lib/cabinet-overview";

import { Button } from "./ui/button";
import { Calculator } from "./calculator";
import { ClientActions } from "./client-actions";
import { ContractList } from "./contract-list";
import { PaymentWorkspace } from "./payment-workspace";
import { TelegramInvite } from "./telegram-invite";
import { SellerSettings } from "./seller-settings";
import { BuyerCabinet } from "./buyer-cabinet";
import { MerchantOverview } from "./merchant-overview";
import { PaymentMethods } from "./payment-methods";
import { AddOverdueReport, OverdueRegistry } from "./overdue-registry";
import { PlatformAccess, type AccessState } from "./platform-access";
import { PlatformCustomers } from "./platform-customers";
import { PlatformTelegram } from "./platform-telegram";
import type {
  State,
  Session,
  Application,
  Contract,
  Customer,
  Payment,
} from "@/lib/types";
import {
  money,
  cents,
  rubles,
  sum,
  diff,
  today,
  addMonths,
  calculate,
} from "@/lib/money";
import {
  metrics,
  contractDebt,
  contractPaid,
  scheduleRemaining,
  datePlus,
} from "@/lib/metrics";
const statuses: Record<string, string> = {
  draft: "Черновик",
  review: "На рассмотрении",
  clarification: "Нужно уточнение",
  approved: "Одобрена",
  rejected: "Отклонена",
  awaiting_purchase: "Ожидает закупки",
  purchased: "Товар приобретён",
  ready_to_sell: "Готова к продаже",
  contracted: "Договор заключён",
  signed: "Договор заключён",
  transferred: "Товар передан",
  closed: "Завершён",
  pending: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  failed: "Повторная попытка",
};
const roles: Record<string, string> = {
  owner: "Владелец организации",
  manager: "Менеджер",
  cashier: "Кассир",
  client: "Личный кабинет",
};
const dt = (d: string) =>
  new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("ru-RU");
const short = (id: string) => id.slice(0, 8).toUpperCase();
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (["review", "awaiting_purchase", "signed", "pending"].includes(value)
          ? "warn"
          : value === "rejected" || value === "failed"
            ? "danger"
            : "")
      }
    >
      {statuses[value] ?? value}
    </span>
  );
}
function Heading({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {children}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Empty({ text = "Пока нет записей" }: { text?: string }) {
  return <div className="empty">{text}</div>;
}
function Definition({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="definition">
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
type Run = (
  action: string,
  payload: unknown,
  notice?: string,
) => Promise<{ id: string } | null>;
export function CRM({
  initial,
  session: s,
  path,
  demo,
  telegram = false,
  initialAccess,
}: {
  initial: State;
  session: Session;
  path: string[];
  demo: boolean;
  telegram?: boolean;
  initialAccess?: AccessState;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const keys = useRef(new Map<string, string>());
  const commandPending = useRef(false);
  const dataOutdated = useRef(false);
  const moreMenu = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setData(initial);
    setError("");
    dataOutdated.current = false;
  }, [initial]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  async function reload() {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.status === 401) {
      router.push("/login");
      return;
    }
    if (!r.ok)
      throw new Error("Не удалось обновить данные. Попробуйте ещё раз.");
    setData(await r.json());
    dataOutdated.current = false;
    setError("");
  }
  const run: Run = async (action, payload, notice = "Изменения сохранены") => {
    if (commandPending.current) return null;
    if (dataOutdated.current) {
      setError(
        "Предыдущая операция сохранена. Сначала обновите данные кнопкой обновления, чтобы не записать её повторно.",
      );
      return null;
    }
    commandPending.current = true;
    setBusy(true);
    setError("");
    const hash = JSON.stringify([action, payload]);
    const key = keys.current.get(hash) ?? crypto.randomUUID();
    keys.current.set(hash, key);
    try {
      const r = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload,
          key,
          tenant_id: s.tenant_id ?? undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      keys.current.delete(hash);
      try {
        await reload();
      } catch {
        dataOutdated.current = true;
        setError(
          "Операция сохранена, но экран не обновился. Обновите данные; повторно записывать платёж не нужно.",
        );
      }
      setToast(notice);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      commandPending.current = false;
      setBusy(false);
    }
  };
  const section = path[0] ?? "dashboard";
  const staff = s.role === "owner" || s.role === "manager";
  const cashier = s.role === "owner" || s.role === "cashier";
  const nav =
    s.role === "client"
      ? [["cabinet", "Мои договоры", FileText]]
      : s.platform_admin && !s.tenant_id
        ? [
            ["platform-requests", "Заявки", ShoppingBag],
            ["platform", "Компании", Building2],
            ["platform-customers", "Клиенты", Users],
            ["registry", "Чёрный список", Users],
          ]
        : [
            ["dashboard", "Обзор", LayoutDashboard],
            ...(staff
              ? [
                  ["applications", "Заявки", ShoppingBag],
                  ["customers", "Клиенты", Users],
                ]
              : []),
            ["contracts", "Договоры", FileText],
            ...(cashier ? [["payments", "Платежи", CircleDollarSign]] : []),
            ...(s.role === "owner"
              ? [
                  ["registry", "Чёрный список", Users],
                  ["settings", "Настройки", Settings],
                ]
              : []),
          ];
  const title =
    (nav.find((n) => n[0] === section)?.[1] as string) ??
    "Рабочее пространство";
  const extraNav =
    nav.length > 5
      ? nav.filter(([key]) =>
          ["customers", "registry", "settings"].includes(String(key)),
        )
      : [];
  const go = (url: string) => router.push(url);
  if (s.role === "client")
    return (
      <>
        <BuyerCabinet
          data={data}
          session={s}
          run={run}
          busy={busy}
          reload={reload}
        />
        {error && (
          <div role="alert" className="pocket-alert">
            {error}
          </div>
        )}
        {toast && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell merchant-app">
      <aside className="sidebar">
        <Brand light href="/crm" />
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="side-nav">
          {nav.map(([key, label, Icon]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <Link
                key={String(key)}
                className={
                  "side-link " +
                  (extraNav.some(([extra]) => extra === key)
                    ? "secondary-link "
                    : "") +
                  (section === key ? "active" : "")
                }
                aria-current={section === key ? "page" : undefined}
                href={
                  key === "cabinet"
                    ? "/cabinet"
                    : key === "dashboard"
                      ? "/crm"
                      : "/crm/" + key
                }
              >
                <I size={17} />
                {String(label)}
              </Link>
            );
          })}
          {extraNav.length > 0 && (
            <button
              type="button"
              className={
                "side-link more-link " +
                (extraNav.some(([key]) => key === section) ? "active" : "")
              }
              onClick={() => moreMenu.current?.showModal()}
              aria-haspopup="dialog"
            >
              <Ellipsis size={20} />
              Ещё
            </button>
          )}
        </nav>
        <div className="side-bottom">
          <Link href="/" className="side-link">
            <ArrowUpRight size={17} />
            Открыть приложение
          </Link>
          <div className="tenant-card">
            <strong>
              {s.platform_admin && !s.tenant_id
                ? "Платформа"
                : (data.organizations[0]?.name ?? "Организация")}
            </strong>
            <span>
              {demo ? "Демонстрационное пространство" : "Рабочее пространство"}
            </span>
          </div>
        </div>
      </aside>
      {extraNav.length > 0 && (
        <dialog
          className="hesap-dialog more-menu"
          ref={moreMenu}
          aria-labelledby="more-menu-heading"
          onClick={(e) => {
            if (e.target === e.currentTarget) moreMenu.current?.close();
          }}
        >
          <div className="row between">
            <h2 id="more-menu-heading">Разделы</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть меню"
              onClick={() => moreMenu.current?.close()}
              autoFocus
            >
              <X size={20} />
            </button>
          </div>
          {extraNav.map(([key, label, Icon]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <Link
                className="more-menu-link"
                key={String(key)}
                href={"/crm/" + key}
                aria-current={section === key ? "page" : undefined}
                onClick={() => moreMenu.current?.close()}
              >
                <I size={21} />
                <span>{String(label)}</span>
                <ChevronRight size={17} />
              </Link>
            );
          })}
        </dialog>
      )}
      <main className="app-main">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand href={s.platform_admin ? "/crm/platform" : "/crm"} />
          </div>
          <div className="breadcrumb">
            Рабочее пространство{" "}
            <ChevronRight
              style={{
                display: "inline",
                verticalAlign: "middle",
                margin: "0 7px",
              }}
              size={12}
            />
            <span>{title}</span>
          </div>
          <div className="row">
            {!s.platform_admin && (
              <button
                className="btn btn-ghost btn-icon"
                aria-label="Обновить рабочий кабинет"
                disabled={busy || refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  setError("");
                  try {
                    await reload();
                    setToast("Данные обновлены");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <RefreshCw
                  size={17}
                  className={refreshing ? "is-refreshing" : ""}
                />
              </button>
            )}
            {
              <Link
                aria-label="Уведомления"
                className={s.platform_admin ? "notification-dot owner-delivery-link" : "notification-dot"}
                href={
                  s.platform_admin
                    ? "/crm/platform-notifications"
                    : "/crm/notifications"
                }
              >
                <Bell size={17} />
              </Link>
            }
            <div className="row">
              <span className="avatar">{s.name?.[0] ?? "Р"}</span>
              <div>
                <div className="user-name">{s.name}</div>
                <div className="user-role">
                  {roles[s.role ?? ""] ?? "Администратор платформы"}
                </div>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              aria-label="Выйти"
              onClick={async () => {
                await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className="app-body">
          {demo && (
            <div className="demo-banner">
              ДЕМО-РЕЖИМ · Все клиенты и операции вымышлены · Реальные платежи
              не подключены
            </div>
          )}
          {error && (
            <div className="error inline-error" role="alert">
              {error}
            </div>
          )}
          {section === "dashboard" && (
            <MerchantOverview data={data} session={s} />
          )}
          {section === "platform-requests" && s.platform_admin && (
            <PlatformAccess initialAccess={initialAccess} view="requests" />
          )}
          {section === "platform-notifications" && s.platform_admin && (
            <>
              <PlatformAccess
                initialAccess={initialAccess}
                view="notifications"
              />
              {telegram && <PlatformTelegram />}
            </>
          )}
          {section === "platform-customers" && s.platform_admin && (
            <PlatformCustomers />
          )}
          {section === "registry" &&
            (s.role === "owner" || s.platform_admin) && (
              <OverdueRegistry merchant={s.role === "owner"} />
            )}
          {section === "customers" &&
            staff &&
            (path[1] === "new" ? (
              <CustomerForm
                run={run}
                busy={busy}
                done={(id) => go("/crm/customers/" + id)}
              />
            ) : path[1] ? (
              <CustomerDetail
                key={path[1]}
                data={data}
                id={path[1]}
                telegram={telegram && s.role === "owner"}
                owner={s.role === "owner"}
              />
            ) : (
              <Customers data={data} />
            ))}
          {section === "applications" &&
            staff &&
            (path[1] === "new" ? (
              <ApplicationForm
                data={data}
                run={run}
                busy={busy}
                done={(id) => go("/crm/applications/" + id)}
              />
            ) : path[1] ? (
              <ApplicationDetail
                data={data}
                id={path[1]}
                run={run}
                busy={busy}
                owner={s.role === "owner"}
                reload={reload}
                onError={setError}
                go={go}
              />
            ) : (
              <Applications data={data} />
            ))}
          {section === "contracts" &&
            (path[1] ? (
              <ContractDetail
                data={data}
                id={path[1]}
                run={run}
                busy={busy}
                staff={staff}
                cashier={cashier}
              />
            ) : (
              <ContractList data={data} />
            ))}
          {section === "payments" && cashier && (
            <PaymentWorkspace
              data={data}
              run={run}
              busy={busy}
              owner={s.role === "owner"}
              form={<PaymentForm data={data} run={run} busy={busy} />}
            />
          )}
          {section === "cash" && cashier && (
            <Cash
              data={data}
              run={run}
              busy={busy}
              owner={s.role === "owner"}
            />
          )}
          {section === "settings" && s.role === "owner" && (
            <>
              <SellerSettings data={data} run={run} busy={busy} />
              <PaymentMethods edit tenantId={s.tenant_id ?? undefined} />
              <details className="card pad mt">
                <summary>Условия рассрочки</summary>
                <SettingsPage data={data} run={run} busy={busy} />
              </details>
              <details className="card pad mt">
                <summary>Счета для учёта поступлений</summary>
                <Cash data={data} run={run} busy={busy} owner={true} />
              </details>
              {telegram && <TelegramInvite />}
            </>
          )}
          {section === "calculator" && (
            <>
              <Heading
                title="Калькулятор мурабахи"
                sub="Предварительный расчёт · окончательная цена фиксируется после закупки"
              />
              <Calculator pricing={data.settings[0]} applyLink={false} />
            </>
          )}
          {section === "reports" && <Reports data={data} />}
          {section === "notifications" && (
            <>
              <Heading
                title="Уведомления"
                sub="Сообщения о заявках и платежах"
              />
              <div className="hint mb">
                {demo
                  ? "В деморежиме сообщения не отправляются. Очередь показывает события, которые получит администратор."
                  : "Сообщения приходят в Telegram. Для их получения запустите бота HESAP."}
              </div>
              <div className="card">
                {data.notifications.map((n) => (
                  <div
                    className="pad"
                    key={n.id}
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    <div className="row between">
                      <p>{n.message}</p>
                      <Status value={n.status} />
                    </div>
                    <small className="muted">
                      {dt(n.created_at)} · попыток: {n.attempts}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
          {section === "cabinet" && (
            <>
              <Link className="btn btn-outline mb" href="/cabinet/setup">
                Профиль и выбор предпринимателя
              </Link>
              <button
                className="btn btn-outline mb"
                onClick={() => void reload()}
                disabled={busy}
              >
                Обновить заявки и платежи
              </button>
              <ClientActions data={data} run={run} busy={busy} />
              <Cabinet data={data} />
            </>
          )}
          {section === "platform" && s.platform_admin && (
            <PlatformAccess initialAccess={initialAccess} view="companies" />
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} style={{ display: "inline", marginRight: 10 }} />
          {toast}
        </div>
      )}
    </div>
  );
}
function FilterBar({
  from,
  to,
  setFrom,
  setTo,
  employee,
  setEmployee,
  status,
  setStatus,
  data,
}: {
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
  employee: string;
  setEmployee: (s: string) => void;
  status: string;
  setStatus: (s: string) => void;
  data: State;
}) {
  return (
    <div className="filters mb">
      <Field label="С даты">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <Field label="По дату">
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Field label="Сотрудник">
        <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">Все сотрудники</option>
          {Array.from(new Set(data.contracts.map((c) => c.created_by))).map(
            (id) => (
              <option key={id} value={id}>
                {short(id)}
              </option>
            ),
          )}
        </select>
      </Field>
      <Field label="Статус">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все договоры</option>
          <option value="signed">Заключены</option>
          <option value="transferred">Переданы</option>
          <option value="closed">Завершены</option>
        </select>
      </Field>
    </div>
  );
}
function useFilters(data: State) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [employee, setEmployee] = useState(""),
    [status, setStatus] = useState("");
  const contracts = data.contracts.filter(
    (c) =>
      (!from || c.signed_on >= from) &&
      (!to || c.signed_on <= to) &&
      (!employee || c.created_by === employee) &&
      (!status || c.status === status),
  );
  const payments = data.payments.filter(
    (p) => (!from || p.paid_on >= from) && (!to || p.paid_on <= to),
  );
  return {
    from,
    to,
    employee,
    status,
    setFrom,
    setTo,
    setEmployee,
    setStatus,
    data,
    contracts,
    payments,
  };
}
function Dashboard({ data, s }: { data: State; s: Session }) {
  const f = useFilters(data);
  const m = metrics(data, f.contracts, f.payments);
  const chart = Array.from({ length: 6 }, (_, i) => {
    const month = addMonths(today().slice(0, 8) + "01", i - 5).slice(0, 7);
    return {
      month,
      amount: sum(
        f.payments
          .filter(
            (p) =>
              p.paid_on.startsWith(month) &&
              f.contracts.some((c) => c.id === p.contract_id),
          )
          .map((p) => p.amount),
      ),
    };
  });
  const max = Decimal.max(1, ...chart.map((x) => x.amount));
  const review = data.applications.filter((a) => a.status === "review").length;
  return (
    <>
      <Heading
        title="Обзор бизнеса"
        sub="Понятная картина каждой сделки и каждого поступления"
      >
        {["owner", "manager"].includes(s.role ?? "") && (
          <Button asChild>
            <Link href="/crm/applications/new">
              <Plus size={16} /> Новая заявка
            </Link>
          </Button>
        )}
      </Heading>
      <FilterBar {...f} />
      <div className="stats">
        {[
          [
            "В портфеле договоров",
            money(m.price, true),
            `${m.active} с непогашенной задолженностью`,
            FileText,
            "",
          ],
          [
            "Получено за период",
            money(m.received, true),
            "Фактически зарегистрированные поступления",
            Wallet,
            "emerald",
          ],
          [
            "Остаток задолженности",
            money(m.debt, true),
            "По выбранным договорам, на сегодня",
            CircleDollarSign,
            "",
          ],
          [
            "Договорная прибыль",
            money(m.profit, true),
            "Зафиксирована в цене · не поступления",
            ChartNoAxesCombined,
            "",
          ],
        ].map(([label, value, foot, Icon, style]) => {
          const I = Icon as typeof Wallet;
          return (
            <div className={"card stat " + style} key={String(label)}>
              <div className="stat-label">
                {String(label)}
                <I size={17} />
              </div>
              <div className="stat-value">{String(value)}</div>
              <div className="stat-foot">{String(foot)}</div>
            </div>
          );
        })}
      </div>
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-heading">
            <div>
              <h3>Динамика поступлений</h3>
              <p>Подтверждённые операции с учётом отмен</p>
            </div>
            <span className="badge neutral">6 месяцев</span>
          </div>
          <div className="chart">
            {chart.map((x) => (
              <div className="bar-column" key={x.month}>
                <div className="bar-amount">{money(x.amount, true)}</div>
                <div
                  className="bar"
                  style={{
                    height: `${Decimal.max(0, new Decimal(x.amount)).div(max).mul(70).toNumber()}%`,
                  }}
                  title={money(x.amount)}
                />
                <span className="bar-label">
                  {new Date(x.month + "-01T00:00:00").toLocaleDateString(
                    "ru-RU",
                    { month: "short" },
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-heading">
            <div>
              <h3>Требует внимания</h3>
              <p>Что важно не упустить</p>
            </div>
            <Activity size={17} className="muted" />
          </div>
          <div className="attention">
            {[
              [
                ShoppingBag,
                `${review} новых заявок`,
                "Ожидают вашего решения",
                "/crm/applications",
              ],
              [
                Clock,
                money(m.overdue, true),
                "Просроченная задолженность",
                "/crm/reports",
              ],
              [
                CalendarDays,
                money(m.week, true),
                "К поступлению за 7 дней",
                "/crm/reports",
              ],
            ].map(([Icon, value, label, href]) => {
              const I = Icon as typeof Clock;
              return (
                <Link
                  className="attention-item"
                  key={String(label)}
                  href={String(href)}
                >
                  <div className="attention-icon">
                    <I size={19} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong>{String(value)}</strong>
                    <p>{String(label)}</p>
                  </div>
                  <ChevronRight size={15} className="muted" />
                </Link>
              );
            })}
            <Link className="quick-link" href="/crm/reports">
              Открыть финансовый отчёт <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-heading">
          <div>
            <h3>Договоры в работе</h3>
            <p>Условия, поступления и остаток</p>
          </div>
          <Link
            className="row muted"
            style={{ fontSize: 11 }}
            href="/crm/contracts"
          >
            Все договоры <ArrowRight size={14} />
          </Link>
        </div>
        <ContractTable
          data={data}
          contracts={f.contracts.slice(0, 5)}
          embedded
        />
      </div>
      <div className="hint mt">
        Период фильтрует договоры по дате заключения, поступления — по дате
        оплаты. Задолженность и ближайшие платежи показаны на сегодня по
        выбранным договорам.
      </div>
    </>
  );
}
function ContractTable({
  data,
  contracts,
  embedded = false,
}: {
  data: State;
  contracts: Contract[];
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "table-wrap" : "card table-wrap"}>
      {!contracts.length ? (
        <Empty />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Договор / клиент</th>
              <th>Товар</th>
              <th>Цена продажи</th>
              <th>Остаток</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="cell-main" href={"/crm/contracts/" + c.id}>
                    {c.number}
                  </Link>
                  <span className="cell-sub">
                    {data.customers.find((x) => x.id === c.customer_id)?.name ??
                      "Клиент договора"}
                  </span>
                </td>
                <td>
                  {
                    data.contract_items.find((x) => x.contract_id === c.id)
                      ?.product_name
                  }
                </td>
                <td className="number">{money(c.sale_price, true)}</td>
                <td className="number">{money(contractDebt(data, c), true)}</td>
                <td>
                  <Status value={c.status} />
                </td>
                <td>
                  <Link
                    aria-label={"Открыть " + c.number}
                    href={"/crm/contracts/" + c.id}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function Customers({ data }: { data: State }) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("name");
  const rows = data.customers
    .filter((c) =>
      (c.name + " " + c.phone + " " + c.id)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.created_at.localeCompare(a.created_at),
    );
  return (
    <>
      <Heading
        title="Клиенты"
        sub="История отношений, договоры и задолженность"
      >
        <Button asChild>
          <Link href="/crm/customers/new">
            <Plus size={16} />
            Новый клиент
          </Link>
        </Button>
      </Heading>
      <div className="toolbar">
        <Search size={17} className="muted" />
        <input
          className="input"
          placeholder="Имя, телефон или ID"
          aria-label="Поиск клиентов"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">По имени</option>
          <option value="date">Сначала новые</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Телефон</th>
              <th>Договоры</th>
              <th>Задолженность</th>
              <th>Добавлен</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="cell-main" href={"/crm/customers/" + c.id}>
                    {c.name}
                  </Link>
                  <span className="cell-sub">ID {short(c.id)}</span>
                </td>
                <td>{c.phone}</td>
                <td>
                  {data.contracts.filter((k) => k.customer_id === c.id).length}
                </td>
                <td className="number">
                  {money(
                    sum(
                      data.contracts
                        .filter((k) => k.customer_id === c.id)
                        .map((k) => contractDebt(data, k)),
                    ),
                  )}
                </td>
                <td>{dt(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </div>
    </>
  );
}
function CustomerForm({
  run,
  busy,
  done,
}: {
  run: Run;
  busy: boolean;
  done: (id: string) => void;
}) {
  return (
    <>
      <Heading
        title="Новый клиент"
        sub="Только вымышленные сведения. Паспортные данные не нужны."
      />
      <form
        className="card pad form-box"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const result = await run("customer.create", Object.fromEntries(f));
          if (result) done(result.id);
        }}
      >
        <Field label="ФИО / имя клиента">
          <input
            name="name"
            placeholder="Демо Клиент 07"
            required
            minLength={2}
            maxLength={120}
          />
        </Field>
        <div className="grid2">
          <Field label="Телефон">
            <input name="phone" placeholder="+7 000 000 00 07" required />
          </Field>
          <Field label="Email · необязательно">
            <input
              name="email"
              type="email"
              placeholder="client7@example.invalid"
            />
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea name="notes" maxLength={2000} />
        </Field>
        <Button disabled={busy}>Создать клиента</Button>
      </form>
    </>
  );
}
function CustomerDetail({
  data,
  id,
  telegram,
  owner,
}: {
  data: State;
  id: string;
  telegram: boolean;
  owner: boolean;
}) {
  const c = data.customers.find((c) => c.id === id);
  if (!c) return <Empty text="Клиент не найден или недоступен" />;
  const contracts = data.contracts.filter((k) => k.customer_id === id);
  return (
    <>
      <Heading title={c.name} sub={"ID " + c.id} />
      <div className="card pad mb">
        <Definition
          items={[
            ["Телефон", c.phone],
            ["Email", c.email ?? "—"],
            ["Зарегистрирован", dt(c.created_at)],
            [
              "Остаток",
              money(sum(contracts.map((k) => contractDebt(data, k)))),
            ],
          ]}
        />
        {c.notes && <p className="hint mt">{c.notes}</p>}
      </div>
      {telegram && (
        <TelegramInvite customerId={id} hasAccount={!!c.auth_user_id} />
      )}
      <h3 className="mb">Договоры клиента</h3>
      {owner && <AddOverdueReport data={data} customerId={id} />}
      <ContractTable data={data} contracts={contracts} />
      <h3 className="mt mb">История заявок</h3>
      <div className="card">
        {data.applications
          .filter((a) => a.customer_id === id)
          .map((a) => (
            <Link
              className="report-row"
              style={{ padding: "18px 22px" }}
              key={a.id}
              href={"/crm/applications/" + a.id}
            >
              <span>{a.product_name}</span>
              <Status value={a.status} />
            </Link>
          ))}
      </div>
      <h3 className="mt mb">История поступлений</h3>
      <PaymentTable
        data={data}
        payments={data.payments.filter((p) =>
          contracts.some((c) => c.id === p.contract_id),
        )}
      />
    </>
  );
}
function Applications({ data }: { data: State }) {
  const [search, setSearch] = useState("");
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "";
  const rows = data.applications
    .filter(
      (a) =>
        (!status || a.status === status) &&
        matchesSearch(search, [
          a.product_name,
          data.customers.find((c) => c.id === a.customer_id)?.name,
          data.customers.find((c) => c.id === a.customer_id)?.phone,
        ]),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <>
      <Heading
        title="Заявки"
        sub="Рассматривайте заявки и согласовывайте условия"
      >
        <Button asChild>
          <Link href="/crm/applications/new">
            <Plus size={16} />
            Новая заявка
          </Link>
        </Button>
      </Heading>
      <div className="toolbar">
        <input
          className="input"
          aria-label="Поиск заявок"
          placeholder="Товар, клиент или телефон"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          aria-label="Статус заявки"
          value={status}
          onChange={(e) =>
            router.replace(
              "/crm/applications" +
                (e.target.value
                  ? "?status=" + encodeURIComponent(e.target.value)
                  : ""),
              { scroll: false },
            )
          }
        >
          <option value="">Все статусы</option>
          {Object.entries(statuses)
            .slice(0, 9)
            .map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
        </select>
      </div>
      <div className="mobile-application-list">
        {rows.map((a) => (
          <Link
            className="card application-summary"
            key={a.id}
            href={"/crm/applications/" + a.id}
          >
            <div className="row between">
              <Status value={a.status} />
              <small>{dt(a.created_at)}</small>
            </div>
            <h2>{a.product_name}</h2>
            <p>{data.customers.find((c) => c.id === a.customer_id)?.name}</p>
            <div className="row between">
              <strong>{money(a.estimated_cost)}</strong>
              <span>
                {a.months} мес. <ArrowUpRight size={16} />
              </span>
            </div>
          </Link>
        ))}
        {!rows.length && (
          <Empty
            text={
              search || status
                ? "Заявки не найдены. Измените поиск или статус."
                : "Заявок пока нет"
            }
          />
        )}
      </div>
      <div className="card table-wrap desktop-application-table">
        <table>
          <thead>
            <tr>
              <th>Товар / заявка</th>
              <th>Клиент</th>
              <th>Стоимость</th>
              <th>Срок</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link
                    href={"/crm/applications/" + a.id}
                    className="cell-main"
                  >
                    {a.product_name}
                  </Link>
                  <span className="cell-sub">
                    #{short(a.id)} · {dt(a.created_at)}
                  </span>
                </td>
                <td>
                  {data.customers.find((c) => c.id === a.customer_id)?.name}
                </td>
                <td className="number">{money(a.estimated_cost, true)}</td>
                <td>{a.months} мес.</td>
                <td>
                  <Status value={a.status} />
                </td>
                <td>
                  <Link
                    aria-label={"Открыть " + a.product_name}
                    href={"/crm/applications/" + a.id}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </div>
    </>
  );
}
function ApplicationForm({
  data,
  run,
  busy,
  done,
}: {
  data: State;
  run: Run;
  busy: boolean;
  done: (id: string) => void;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <Heading
        title="Новая заявка"
        sub="Предварительные условия · договор оформляется после закупки"
      />
      <form
        className="card pad form-box"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const p = {
              ...Object.fromEntries(f),
              estimated_cost: cents(String(f.get("estimated_cost"))),
              down_payment: cents(String(f.get("down_payment"))),
              months: Number(f.get("months")),
            };
            const result = await run("application.create", p);
            if (result) done(result.id);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Field label="Клиент">
          <select name="customer_id" required defaultValue="">
            <option value="" disabled>
              Выберите клиента
            </option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Link
          className="table-link"
          style={{ fontSize: 11 }}
          href="/crm/customers/new"
        >
          + Сначала добавить клиента
        </Link>
        <div className="mt">
          <Field label="Наименование товара">
            <input
              name="product_name"
              placeholder="Конкретная модель и комплектация"
              required
              minLength={2}
            />
          </Field>
        </div>
        <Field label="Ссылка на товар">
          <input name="product_url" type="url" placeholder="https://…" />
        </Field>
        <Field label="Поставщик">
          <input name="supplier" placeholder="Магазин или продавец" />
        </Field>
        <div className="grid3">
          <Field label="Стоимость закупки, ₽">
            <input
              name="estimated_cost"
              inputMode="decimal"
              defaultValue="120000"
              required
            />
          </Field>
          <Field label="Взнос, ₽">
            <input
              name="down_payment"
              inputMode="decimal"
              defaultValue="20000"
              required
            />
          </Field>
          <Field label="Срок, месяцев">
            <input
              name="months"
              type="number"
              min={1}
              max={36}
              defaultValue={6}
              required
            />
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea name="notes" />
        </Field>
        <div className="hint mb">
          Предполагаемая прибыль рассчитывается по текущему тарифу.
          Окончательная цена потребует повторного согласования после закупки.
        </div>
        {error && (
          <p className="error mb" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy || !data.customers.length}>
          Создать заявку
        </Button>
      </form>
    </>
  );
}
function ApplicationDetail({
  data,
  id,
  run,
  busy,
  owner,
  reload,
  onError,
  go,
}: {
  data: State;
  id: string;
  run: Run;
  busy: boolean;
  owner: boolean;
  reload: () => Promise<void>;
  onError: (s: string) => void;
  go: (s: string) => void;
}) {
  const a = data.applications.find((x) => x.id === id);
  const [uploading, setUploading] = useState(false),
    [localError, setLocalError] = useState("");
  if (!a) return <Empty text="Заявка не найдена или недоступна" />;
  const p = data.purchases.find((p) => p.application_id === id),
    docs = data.documents.filter((d) => d.application_id === id);
  let quote: ReturnType<typeof calculate> | undefined;
  try {
    quote = calculate({
      cost: a.estimated_cost,
      down: a.down_payment,
      months: a.months,
      firstDate: addMonths(today(), 1),
      pricing: data.settings[0],
    });
  } catch {}
  async function upload(file: File) {
    setUploading(true);
    onError("");
    try {
      const f = new FormData();
      f.set("file", file);
      f.set("application_id", id);
      f.set("kind", "purchase_receipt");
      const res = await fetch("/api/upload", { method: "POST", body: f });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      await reload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <Heading
        title={a.product_name}
        sub={"Заявка #" + short(a.id) + " · " + dt(a.created_at)}
      >
        <Status value={a.status} />
      </Heading>
      <div className="workflow">
        {[
          "review",
          "approved",
          "awaiting_purchase",
          "purchased",
          "ready_to_sell",
          "contracted",
        ].map((k) => (
          <span className={a.status === k ? "current" : ""} key={k}>
            {statuses[k]}
          </span>
        ))}
      </div>
      <div className="detail-grid">
        <div className="stack">
          <div className="card pad">
            <h3 className="mb">Запрос клиента</h3>
            <Definition
              items={[
                [
                  "Клиент",
                  data.customers.find((c) => c.id === a.customer_id)?.name ??
                    "—",
                ],
                ["Поставщик", a.supplier || "Не указан"],
                [
                  "Город",
                  data.customers.find((c) => c.id === a.customer_id)?.city ||
                    "—",
                ],
                [
                  "Телефон",
                  data.customers.find((c) => c.id === a.customer_id)?.phone ??
                    "—",
                ],
                ["Ориентир стоимости", money(a.estimated_cost)],
                [
                  "Предполагаемая прибыль",
                  quote ? money(quote.profit) : "Согласуется владельцем",
                ],
                ["Взнос", money(a.down_payment)],
                ["Срок", a.months + " месяцев"],
              ]}
            />
            {a.product_url && (
              <a
                className="btn btn-outline mt"
                href={
                  a.product_url.startsWith("https://") ||
                  a.product_url.startsWith("http://")
                    ? a.product_url
                    : "#"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть товар <ArrowUpRight size={14} />
              </a>
            )}
            {a.notes && <p className="hint mt">{a.notes}</p>}
            {docs
              .filter((d) => d.kind === "product_photo")
              .map((d) => (
                <a
                  key={d.id}
                  className="btn btn-outline mt"
                  href={`/api/documents/${d.id}`}
                >
                  Фото товара: {d.name}
                </a>
              ))}
          </div>
          <section className="card pad">
            <h3>Уточнения по заявке</h3>
            {(data.application_messages ?? [])
              .filter((m) => m.application_id === id)
              .map((m) => (
                <p key={m.id} className="hint mt">
                  <strong>
                    {m.author_role === "client"
                      ? "Покупатель"
                      : "Предприниматель"}
                    :
                  </strong>{" "}
                  {m.message}
                </p>
              ))}
            {["review", "clarification"].includes(a.status) && (
              <form
                className="mt"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  if (
                    await run("portal.clarify", {
                      id,
                      message: f.get("message"),
                    })
                  )
                    form.reset();
                }}
              >
                <label className="field">
                  Что нужно уточнить?
                  <textarea
                    name="message"
                    required
                    minLength={2}
                    maxLength={2000}
                  />
                </label>
                <button className="btn btn-outline" disabled={busy}>
                  Запросить уточнение
                </button>
              </form>
            )}
          </section>
          {["review", "clarification", "approved", "draft"].includes(
            a.status,
          ) && (
            <div className="card pad">
              <h3 className="mb">Предварительное согласование</h3>
              <p className="prose-note mb">
                Одобрение разрешает перейти к закупке. Оно не создаёт договор и
                не подтверждает право собственности на товар.
              </p>
              <div className="row wrap">
                {["review", "clarification"].includes(a.status) ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run("application.transition", {
                          id,
                          status: "approved",
                        })
                      }
                    >
                      Одобрить заявку
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run("application.transition", {
                          id,
                          status: "rejected",
                        })
                      }
                    >
                      Отклонить
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run("application.transition", {
                        id,
                        status:
                          a.status === "draft" ? "review" : "awaiting_purchase",
                      })
                    }
                  >
                    {a.status === "draft"
                      ? "На рассмотрение"
                      : "Перейти к закупке"}
                  </Button>
                )}
              </div>
            </div>
          )}
          {a.status === "awaiting_purchase" && (
            <form
              className="card pad"
              onSubmit={async (e) => {
                e.preventDefault();
                setLocalError("");
                const f = new FormData(e.currentTarget);
                try {
                  await run("purchase.record", {
                    id,
                    supplier: f.get("supplier"),
                    cost: cents(String(f.get("cost"))),
                    purchased_on: f.get("purchased_on"),
                    document_id: f.get("document_id"),
                    ownership_confirmed: f.get("ownership_confirmed") === "on",
                  });
                } catch (e) {
                  setLocalError((e as Error).message);
                }
              }}
            >
              <h3 className="mb">Подтверждение приобретения</h3>
              <Field label="Поставщик">
                <input
                  name="supplier"
                  defaultValue={a.supplier}
                  required
                  minLength={2}
                />
              </Field>
              <div className="grid2">
                <Field label="Фактическая стоимость, ₽">
                  <input
                    name="cost"
                    defaultValue={rubles(a.estimated_cost)}
                    required
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Дата покупки">
                  <input
                    name="purchased_on"
                    type="date"
                    defaultValue={today()}
                    max={today()}
                    required
                  />
                </Field>
              </div>
              <Field label="Документ закупки">
                <select name="document_id" defaultValue="" required>
                  <option value="" disabled>
                    Загрузите и выберите документ
                  </option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" name="ownership_confirmed" required />
                <span>
                  Подтверждаю, что организация приобрела товар и получила право
                  собственности. Документ относится к этой закупке.
                </span>
              </label>
              {localError && <p className="error mb">{localError}</p>}
              <Button disabled={busy || !docs.length}>
                Зафиксировать закупку
              </Button>
            </form>
          )}
          {p && (
            <div className="card pad">
              <div className="row mb">
                <PackageCheck className="gold" size={22} />
                <h3>Закупка подтверждена</h3>
              </div>
              <Definition
                items={[
                  ["Себестоимость", money(p.cost)],
                  ["Дата покупки", dt(p.purchased_on)],
                  ["Поставщик", p.supplier],
                  ["Право собственности", "Подтверждено сотрудником"],
                ]}
              />
            </div>
          )}
          {["purchased", "ready_to_sell"].includes(a.status) && p && (
            <QuoteForm
              a={a}
              cost={p.cost}
              data={data}
              owner={owner}
              run={run}
              busy={busy}
            />
          )}
          {a.status === "ready_to_sell" && a.final_quote && (
            <div className="card pad">
              <h3 className="mb">Цена согласована</h3>
              <Definition
                items={[
                  ["Цена продажи", money(String(a.final_quote.sale_price))],
                  ["Прибыль продавца", money(String(a.final_quote.profit))],
                  ["Первый платёж", dt(String(a.final_quote.first_payment_on))],
                  ["Версия тарифа", String(a.final_quote.settings_version)],
                ]}
              />
              <p className="hint mt mb">
                При заключении договора условия и график фиксируются. Подписание
                документа сторонами выполняется отдельно.
              </p>
              <Button
                disabled={busy}
                onClick={async () => {
                  const r = await run(
                    "contract.create",
                    { id },
                    "Договор и график созданы",
                  );
                  if (r) go("/crm/contracts/" + r.id);
                }}
              >
                Создать договор <ArrowRight size={16} />
              </Button>
            </div>
          )}
          {a.status === "contracted" && (
            <Button asChild>
              <Link
                href={
                  "/crm/contracts/" +
                  data.contracts.find((c) => c.application_id === id)?.id
                }
              >
                Открыть договор <ArrowUpRight size={16} />
              </Link>
            </Button>
          )}
        </div>
        <div className="stack">
          <div className="card pad">
            <h3 className="mb">Документы закупки</h3>
            <p className="muted mb" style={{ fontSize: 12 }}>
              PDF, JPEG или PNG · до 5 МБ. Прикрепите документы, подтверждающие
              закупку.
            </p>
            {docs.map((d) => (
              <div className="report-row" key={d.id}>
                <span>{d.name}</span>
                <a
                  href={"/api/documents/" + d.id}
                  aria-label={"Скачать " + d.name}
                >
                  <Download size={16} />
                </a>
              </div>
            ))}
            {a.status !== "contracted" && (
              <Field label={uploading ? "Загружаем…" : "Загрузить документ"}>
                <input
                  aria-label="Загрузить документ закупки"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f);
                    e.target.value = "";
                  }}
                />
              </Field>
            )}
            {!docs.length && (
              <p className="hint">
                Без документа и подтверждения приобретения договор недоступен.
              </p>
            )}
          </div>
          <div className="card pad">
            <h3 className="mb">История сделки</h3>
            <ul className="timeline">
              <li>
                Заявка создана<small>{dt(a.created_at)}</small>
              </li>
              {data.audit_logs
                .filter((x) => x.entity_id === id)
                .slice()
                .reverse()
                .map((x) => (
                  <li key={x.id}>
                    {x.action === "application.transition"
                      ? `${statuses[x.details.previous_status] ?? ""} → ${statuses[x.details.status] ?? ""}`
                      : x.action === "purchase.record"
                        ? "Закупка подтверждена"
                        : x.action === "quote.confirm"
                          ? "Окончательная цена согласована"
                          : x.action}
                    <small>
                      {dt(x.created_at)} · {short(x.actor_id ?? "система")}
                    </small>
                  </li>
                ))}
            </ul>
            {!owner && (
              <small className="muted">
                Полный журнал аудита доступен владельцу.
              </small>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
function QuoteForm({
  a,
  cost,
  data,
  owner,
  run,
  busy,
}: {
  a: Application;
  cost: string;
  data: State;
  owner: boolean;
  run: Run;
  busy: boolean;
}) {
  const [custom, setCustom] = useState(data.settings[0].mode === "individual"),
    [error, setError] = useState("");
  return (
    <form
      className="card pad"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await run("quote.confirm", {
            id: a.id,
            months: Number(f.get("months")),
            down_payment: cents(String(f.get("down_payment"))),
            first_payment_on: f.get("first_payment_on"),
            agreed: f.get("agreed") === "on",
            ...(custom
              ? {
                  custom_kind: f.get("custom_kind"),
                  custom_value: cents(String(f.get("custom_value"))),
                }
              : {}),
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h3 className="mb">Окончательное согласование</h3>
      <p className="hint mb">
        Расчёт будет выполнен от фактической себестоимости {money(cost)} по
        тарифу v{data.settings[0].version}. Для индивидуальной прибыли нужны
        права владельца.
      </p>
      <div className="grid2">
        <Field label="Первоначальный взнос, ₽">
          <input
            name="down_payment"
            defaultValue={rubles(a.down_payment)}
            required
          />
        </Field>
        <Field label="Срок, месяцев">
          <input
            name="months"
            type="number"
            min={1}
            max={36}
            defaultValue={a.months}
            required
          />
        </Field>
      </div>
      <Field label="Дата первого платежа">
        <input
          name="first_payment_on"
          type="date"
          defaultValue={addMonths(today(), 1)}
          min={datePlus(today(), 1)}
          required
        />
      </Field>
      {owner && (
        <label className="check">
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => setCustom(e.target.checked)}
            disabled={data.settings[0].mode === "individual"}
          />
          <span>Индивидуальная прибыль продавца</span>
        </label>
      )}
      {custom && (
        <div className="grid2">
          <Field label="Прибыль">
            <input
              name="custom_value"
              defaultValue="18000"
              required
              disabled={!owner}
            />
          </Field>
          <Field label="Тип значения">
            <select name="custom_kind" disabled={!owner}>
              <option value="rubles">В рублях</option>
              <option value="percent">% от себестоимости</option>
            </select>
          </Field>
        </div>
      )}
      <label className="check">
        <input name="agreed" type="checkbox" required />
        <span>
          Окончательная цена и график повторно согласованы с клиентом после
          закупки товара.
        </span>
      </label>
      {error && <p className="error mb">{error}</p>}
      <Button disabled={busy || (custom && !owner)}>
        Зафиксировать согласованную цену
      </Button>
    </form>
  );
}
function ContractDetail({
  data,
  id,
  run,
  busy,
  staff,
  cashier,
}: {
  data: State;
  id: string;
  run: Run;
  busy: boolean;
  staff: boolean;
  cashier: boolean;
}) {
  const c = data.contracts.find((c) => c.id === id);
  if (!c) return <Empty text="Договор не найден или недоступен" />;
  const item = data.contract_items.find((i) => i.contract_id === id);
  return (
    <>
      <Heading title={c.number} sub={item?.product_name ?? "Договор мурабахи"}>
        <Button variant="outline" asChild>
          <a href={"/api/contracts/" + id + "/pdf"}>
            <Download size={16} />
            Скачать PDF
          </a>
        </Button>
      </Heading>
      <div className="card pad mb">
        <div className="row between mb">
          <Status value={c.status} />
          <span className="muted" style={{ fontSize: 11 }}>
            Заключён {dt(c.signed_on)}
          </span>
        </div>
        <Definition
          items={[
            [
              "Клиент",
              data.customers.find((x) => x.id === c.customer_id)?.name ??
                "Клиент договора",
            ],
            ["Себестоимость", money(c.cost)],
            ["Прибыль продавца", money(c.profit)],
            ["Фиксированная цена", money(c.sale_price)],
            ["Фактически получено", money(contractPaid(data, id))],
            ["Остаток задолженности", money(contractDebt(data, c))],
          ]}
        />
        <div className="hint mt">
          Цена и график сохранены в неизменяемой версии. Первоначальный взнос{" "}
          {money(c.down_payment)} учитывается в полученных деньгах только после
          регистрации оплаты.
        </div>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <ScheduleTable data={data} contract={c} />
          <div>
            <h3 className="mb">История поступлений</h3>
            <PaymentTable
              data={data}
              payments={data.payments.filter((p) => p.contract_id === id)}
            />
          </div>
        </div>
        <div className="stack">
          {cashier && new Decimal(contractDebt(data, c)).gt(0) && (
            <div className="card pad">
              <h3 className="mb">Зарегистрировать платёж</h3>
              <PaymentForm data={data} run={run} busy={busy} contractId={id} />
            </div>
          )}
          {c.status === "signed" && staff && (
            <form
              className="card pad"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await run("contract.transfer", {
                  id,
                  transferred_on: f.get("transferred_on"),
                  reference: f.get("reference"),
                });
              }}
            >
              <h3 className="mb">Передача товара</h3>
              <Field label="Дата передачи">
                <input
                  name="transferred_on"
                  type="date"
                  defaultValue={today()}
                  min={c.signed_on}
                  max={today()}
                  required
                />
              </Field>
              <Field label="Подтверждение передачи">
                <textarea
                  name="reference"
                  placeholder="Номер акта и описание подтверждения"
                  required
                  minLength={3}
                />
              </Field>
              <Button disabled={busy}>Подтвердить передачу</Button>
            </form>
          )}
          {c.transferred_on && (
            <div className="card pad">
              <h3 className="mb">Товар передан</h3>
              <p>{dt(c.transferred_on)}</p>
              <p className="prose-note mt">{c.transfer_reference}</p>
            </div>
          )}
          <div className="hint">
            Документ подготовлен для подписания сторонами. Создание записи в
            HESAP не заменяет подписи и не подтверждает получение оплаты.
          </div>
        </div>
      </div>
    </>
  );
}
function ScheduleTable({
  data,
  contract: c,
}: {
  data: State;
  contract: Contract;
}) {
  return (
    <div className="card">
      <div className="card-heading">
        <h3>График платежей</h3>
        <CalendarDays size={17} className="muted" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Платёж</th>
              <th>Дата</th>
              <th>По графику</th>
              <th>Осталось</th>
            </tr>
          </thead>
          <tbody>
            {data.payment_schedules
              .filter((x) => x.contract_id === c.id)
              .map((row) => {
                const rest = scheduleRemaining(data, row.id, row.amount);
                return (
                  <tr key={row.id}>
                    <td>
                      {row.sequence === 0 ? "Взнос" : "№ " + row.sequence}
                    </td>
                    <td>
                      {dt(row.due_on)}
                      {row.due_on < today() && new Decimal(rest).gt(0) && (
                        <span
                          className="badge danger"
                          style={{ marginLeft: 7 }}
                        >
                          Просрочен
                        </span>
                      )}
                    </td>
                    <td className="number">{money(row.amount)}</td>
                    <td className="number">
                      {new Decimal(rest).isZero() ? (
                        <span className="badge">Оплачен</span>
                      ) : (
                        money(rest)
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function PaymentForm({
  data,
  run,
  busy,
  contractId,
}: {
  data: State;
  run: Run;
  busy: boolean;
  contractId?: string;
}) {
  const [id, setId] = useState(contractId ?? ""),
    [error, setError] = useState(""),
    [amount, setAmount] = useState("");
  const c = data.contracts.find((c) => c.id === id);
  const next = scheduleOverview(data).find(
    (row) => row.contract_id === id && !row.paid,
  );
  const pending = data.payment_claims.filter(
    (claim) =>
      claim.contract_id === id &&
      claim.tenant_id === c?.tenant_id &&
      claim.status === "pending",
  );
  const customer = data.customers.find(
    (row) => row.id === c?.customer_id && row.tenant_id === c?.tenant_id,
  );
  const product = data.contract_items.find(
    (row) => row.contract_id === id && row.tenant_id === c?.tenant_id,
  )?.product_name;
  const accounts = data.cash_accounts.filter(
    (account) => !c || account.tenant_id === c.tenant_id,
  );
  return (
    <form
      className="receipt-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const form = e.currentTarget;
        const f = new FormData(form);
        try {
          if (!c) throw new Error("Выберите договор");
          const value = cents(amount.trim());
          if (new Decimal(value).lte(0))
            throw new Error("Укажите сумму больше нуля");
          if (new Decimal(value).gt(contractDebt(data, c)))
            throw new Error("Сумма превышает остаток по договору");
          const res = await run(
            "payment.record",
            {
              contract_id: id,
              cash_account_id: f.get("cash_account_id"),
              amount: value,
              paid_on: f.get("paid_on"),
            },
            "Платёж зарегистрирован и распределён по графику",
          );
          if (res) {
            form.reset();
            setAmount("");
            if (!contractId) setId("");
          } else
            setError(
              "Не удалось завершить запись. Проверьте сообщение об ошибке перед повторной попыткой.",
            );
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {!contractId && (
        <Field label="Договор">
          <select
            value={id}
            name="contract_id"
            onChange={(e) => {
              setId(e.target.value);
              setAmount("");
              setError("");
            }}
            required
          >
            <option value="">Выберите договор</option>
            {data.contracts
              .filter(
                (c) =>
                  ["signed", "transferred"].includes(c.status) &&
                  new Decimal(contractDebt(data, c)).gt(0),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {data.customers.find(
                    (x) =>
                      x.id === c.customer_id && x.tenant_id === c.tenant_id,
                  )?.name ?? "Клиент"}{" "}
                  · {c.number}
                </option>
              ))}
          </select>
        </Field>
      )}
      {c && (
        <div className="receipt-context mb">
          <strong>{customer?.name ?? "Клиент договора"}</strong>
          <span>{product}</span>
          <span>
            Остаток: <b>{money(contractDebt(data, c))}</b>
          </span>
        </div>
      )}
      {pending.length > 0 && (
        <div className="hint mb">
          У клиента есть сообщение об оплате на проверке. Если это то же
          поступление, подтвердите сообщение, чтобы не записать его дважды.
          <Link
            className="btn btn-outline full mt"
            href="/crm/payments?view=review"
          >
            Открыть проверку оплат
          </Link>
        </div>
      )}
      <Field label="Сумма поступления, ₽">
        <input
          name="amount"
          inputMode="decimal"
          placeholder="0,00"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {next && (
        <button
          className="btn btn-outline receipt-amount mb"
          type="button"
          onClick={() => setAmount(rubles(next.remaining))}
        >
          По графику: {money(next.remaining)}
        </button>
      )}
      <Field label="Куда поступили деньги">
        <select name="cash_account_id" key={id} required defaultValue="">
          <option value="" disabled>
            Выберите счёт или кассу
          </option>
          {accounts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Дата поступления">
        <input
          name="paid_on"
          type="date"
          defaultValue={today()}
          max={today()}
          min={c?.signed_on}
          required
        />
      </Field>
      {error && (
        <p className="error mb" role="alert">
          {error}
        </p>
      )}
      <label className="check" key={"verified-" + id}>
        <input type="checkbox" name="verified" required />
        <span>Деньги действительно получены от этого клиента</span>
      </label>
      {!accounts.length && (
        <p className="hint mb">
          Добавьте счёт для учёта поступлений в настройках компании.
        </p>
      )}
      <Button disabled={busy || !c || !accounts.length} className="full">
        {busy ? "Сохраняем…" : "Записать поступление"}
      </Button>
      <p className="muted mt" style={{ fontSize: 10 }}>
        Запись в CRM не является фискальным чеком или подтверждением банковского
        перевода.
      </p>
    </form>
  );
}
function PaymentTable({
  data,
  payments,
  select,
}: {
  data: State;
  payments: Payment[];
  select?: (p: Payment) => void;
}) {
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Договор</th>
            <th>Сумма</th>
            <th>Операция</th>
            {select && <th />}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{dt(p.paid_on)}</td>
              <td>
                {data.contracts.find((c) => c.id === p.contract_id)?.number}
              </td>
              <td className="number">{money(p.amount)}</td>
              <td>
                {p.reversal_of ? (
                  <span className="badge danger">Отмена</span>
                ) : (
                  <span className="badge">Поступление</span>
                )}
                <span
                  className="cell-sub"
                  style={{ display: "block", marginTop: 4 }}
                >
                  {short(p.id)}
                </span>
              </td>
              {select && (
                <td>
                  {!p.reversal_of &&
                    !data.payments.some((x) => x.reversal_of === p.id) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => select(p)}
                      >
                        Отменить
                      </button>
                    )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!payments.length && <Empty text="Поступлений пока нет" />}
    </div>
  );
}
function Cash({
  data,
  run,
  busy,
  owner,
}: {
  data: State;
  run: Run;
  busy: boolean;
  owner: boolean;
}) {
  const [kind, setKind] = useState("income"),
    [error, setError] = useState("");
  return (
    <>
      <Heading title="Кассы" sub="Движения средств внутри организации" />
      <div className="grid3 mb">
        {data.cash_accounts.map((c) => (
          <div className="card pad" key={c.id}>
            <div className="row between mb">
              <span className="muted">{c.name}</span>
              <Wallet size={19} className="gold" />
            </div>
            <h2>
              {money(
                sum(
                  data.cash_transactions
                    .filter((t) => t.cash_account_id === c.id)
                    .map((t) => t.amount),
                ),
              )}
            </h2>
          </div>
        ))}
      </div>
      <div className="detail-grid">
        <div className="card table-wrap" style={{ alignSelf: "start" }}>
          <div className="card-heading">
            <h3>История операций</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Дата / касса</th>
                <th>Основание</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.cash_transactions.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="cell-main">
                      {
                        data.cash_accounts.find(
                          (c) => c.id === t.cash_account_id,
                        )?.name
                      }
                    </span>
                    <span className="cell-sub">{dt(t.created_at)}</span>
                  </td>
                  <td>{t.description}</td>
                  <td className="number">{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.cash_transactions.length && <Empty />}
        </div>
        <div className="stack">
          <form
            className="card pad"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await run("cash.move", {
                  kind,
                  cash_account_id: f.get("cash_account_id"),
                  amount: cents(String(f.get("amount"))),
                  description: f.get("description"),
                  ...(kind === "transfer"
                    ? { destination_id: f.get("destination_id") }
                    : {}),
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <h3 className="mb">Кассовая операция</h3>
            <Field label="Вид операции">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="income">Приход, не связанный с договором</option>
                <option value="expense">Расход</option>
                <option value="transfer">Перевод между кассами</option>
              </select>
            </Field>
            <Field label="Касса">
              <select name="cash_account_id" required>
                {data.cash_accounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {kind === "transfer" && (
              <Field label="Касса получателя">
                <select name="destination_id" required>
                  {data.cash_accounts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Сумма, ₽">
              <input name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Основание">
              <input name="description" required minLength={3} />
            </Field>
            {error && <p className="error mb">{error}</p>}
            <Button disabled={busy || !data.cash_accounts.length}>
              Провести операцию
            </Button>
            <p className="hint mt">
              Поступления по договору регистрируются в разделе «Платежи», чтобы
              погасить задолженность.
            </p>
          </form>
          {owner && (
            <form
              className="card pad"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await run("cash.create", { name: f.get("name") });
              }}
            >
              <h3 className="mb">Добавить кассу</h3>
              <Field label="Название">
                <input name="name" required minLength={2} />
              </Field>
              <Button variant="outline" disabled={busy}>
                Создать кассу
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
function SettingsPage({
  data,
  run,
  busy,
}: {
  data: State;
  run: Run;
  busy: boolean;
}) {
  const current = data.settings[0];
  const [mode, setMode] = useState(current.mode),
    [error, setError] = useState("");
  return (
    <>
      <Heading
        title="Настройки"
        sub="Условия для новых расчётов вашей организации"
      />
      <div className="section-tabs">
        <a className="active" href="/crm/settings/markups">
          Наценки и тарифы
        </a>
        <a href="#history">История изменений</a>
      </div>
      <div className="detail-grid">
        <form
          className="card pad"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const rows = String(f.get("grid"))
                .split("\n")
                .filter((x) => x.trim());
              const grid: Record<string, number> = {};
              for (const line of rows) {
                const parts = line.split(":").map((x) => x.trim());
                if (parts.length !== 2 || grid[parts[0]] !== undefined)
                  throw new Error(
                    "Формат сетки: срок: наценка, без повторений",
                  );
                grid[parts[0]] = Number(cents(parts[1]));
              }
              await run(
                "settings.update",
                {
                  mode,
                  fixed_bps: Number(cents(String(f.get("fixed")))),
                  term_rates: grid,
                  prevent_negative_cash:
                    f.get("prevent_negative_cash") === "on",
                },
                "Сохранена новая версия тарифов",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="row between mb">
            <h3>Правило ценообразования</h3>
            <span className="badge neutral">Версия {current.version}</span>
          </div>
          <Field label="Режим расчёта">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="fixed">
                Фиксированная наценка от себестоимости
              </option>
              <option value="term">Таблица по сроку рассрочки</option>
              <option value="individual">
                Индивидуальная прибыль продавца
              </option>
            </select>
          </Field>
          <Field
            label="Фиксированная наценка, %"
            hint="Разовая прибыль от себестоимости. Не ставка по кредиту."
          >
            <input
              name="fixed"
              defaultValue={rubles(current.fixed_bps)}
              required
            />
          </Field>
          <Field
            label="Тарифная сетка"
            hint="Одна строка: количество месяцев : разовая наценка в %. Например, 6: 12"
          >
            <textarea
              name="grid"
              style={{ minHeight: 130 }}
              defaultValue={Object.entries(current.term_rates)
                .map(([n, bps]) => `${n}: ${rubles(bps)}`)
                .join("\n")}
            />
          </Field>
          <label className="check">
            <input
              name="prevent_negative_cash"
              type="checkbox"
              defaultChecked={current.prevent_negative_cash}
            />
            <span>Запрещать отрицательный остаток кассы</span>
          </label>
          {error && (
            <p className="error mb" role="alert">
              {error}
            </p>
          )}
          <Button disabled={busy}>Сохранить новую версию</Button>
        </form>
        <div className="stack">
          <div className="card pad">
            <ShieldCheck className="gold" size={25} />
            <h3 className="mt mb">
              Условия уже заключённых
              <br />
              договоров сохраняются
            </h3>
            <p className="prose-note">
              Новый тариф применяется к следующим расчётам. Он не меняет цену,
              прибыль или график ранее оформленного договора. Индивидуальная
              корректировка доступна только владельцу.
            </p>
          </div>
          <div className="card pad" id="history">
            <h3 className="mb">История тарифов</h3>
            <ul className="timeline">
              {data.settings.map((st) => (
                <li key={st.id}>
                  Версия {st.version} ·{" "}
                  {st.mode === "fixed"
                    ? "Фиксированная наценка"
                    : st.mode === "term"
                      ? "Сетка по срокам"
                      : "Индивидуально"}
                  <small>{dt(st.created_at)}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
function Reports({ data }: { data: State }) {
  const f = useFilters(data),
    m = metrics(data, f.contracts, f.payments);
  const ids = new Set(f.contracts.map((c) => c.id));
  const overdue = data.payment_schedules.filter(
    (x) =>
      ids.has(x.contract_id) &&
      x.due_on < today() &&
      new Decimal(scheduleRemaining(data, x.id, x.amount)).gt(0),
  );
  const cash = data.cash_transactions.filter(
    (t) =>
      (!f.from || t.created_at.slice(0, 10) >= f.from) &&
      (!f.to || t.created_at.slice(0, 10) <= f.to),
  );
  return (
    <>
      <Heading
        title="Финансовые отчёты"
        sub="Договорные показатели отдельно от движения денег"
      />
      <FilterBar {...f} />
      <div className="grid2 mb">
        <div className="card pad">
          <h3 className="mb">Договоры и задолженность</h3>
          {[
            ["Заключено сделок", String(f.contracts.length)],
            ["Сумма сделок", money(m.price)],
            ["Себестоимость товаров", money(m.cost)],
            ["Договорная прибыль", money(m.profit)],
            ["Получено за период", money(m.received)],
            ["Задолженность на сегодня", money(m.debt)],
            ["Просрочено", money(m.overdue)],
          ].map(([k, v]) => (
            <div className="report-row" key={k}>
              <span className="muted">{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <div className="card pad">
          <h3 className="mb">Планируемые поступления</h3>
          {[
            ["Сегодня", m.today],
            ["Ближайшие 7 дней", m.week],
            ["Ближайшие 30 дней", m.month],
          ].map(([k, v]) => (
            <div className="report-row" key={k}>
              <span className="muted">{k}</span>
              <strong>{money(v)}</strong>
            </div>
          ))}
          <p className="hint mt">
            Окна 7 и 30 дней включают сегодня. План учитывает непогашенные
            строки графика. Просроченные суммы приведены отдельно.
          </p>
          <h3 className="mt mb">Продажи по сотрудникам</h3>
          {Array.from(new Set(f.contracts.map((c) => c.created_by))).map(
            (u) => (
              <div className="report-row" key={u}>
                <span>Сотрудник {short(u)}</span>
                <strong>
                  {money(
                    sum(
                      f.contracts
                        .filter((c) => c.created_by === u)
                        .map((c) => c.sale_price),
                    ),
                  )}
                </strong>
              </div>
            ),
          )}
        </div>
      </div>
      <h3 className="mb">Просроченные платежи</h3>
      <div className="card table-wrap mb">
        <table>
          <thead>
            <tr>
              <th>Договор</th>
              <th>Срок оплаты</th>
              <th>Дней просрочки</th>
              <th>Остаток</th>
            </tr>
          </thead>
          <tbody>
            {overdue.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link href={"/crm/contracts/" + x.contract_id}>
                    {data.contracts.find((c) => c.id === x.contract_id)?.number}
                  </Link>
                </td>
                <td>{dt(x.due_on)}</td>
                <td>
                  {Math.floor(
                    (Date.parse(today()) - Date.parse(x.due_on)) / 86400000,
                  )}
                </td>
                <td>{money(scheduleRemaining(data, x.id, x.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!overdue.length && <Empty text="Просроченных платежей нет" />}
      </div>
      <h3 className="mb">Реестр договоров</h3>
      <ContractTable data={data} contracts={f.contracts} />
      <h3 className="mt mb">Кассовые движения за период</h3>
      <div className="card pad">
        {data.cash_accounts.length ? (
          data.cash_accounts.map((a) => (
            <div className="report-row" key={a.id}>
              <span>{a.name}</span>
              <span>
                Приход:{" "}
                {money(
                  sum(
                    cash
                      .filter(
                        (t) =>
                          t.cash_account_id === a.id &&
                          new Decimal(t.amount).gt(0),
                      )
                      .map((t) => t.amount),
                  ),
                )}{" "}
                · Расход:{" "}
                {money(
                  new Decimal(
                    sum(
                      cash
                        .filter(
                          (t) =>
                            t.cash_account_id === a.id &&
                            new Decimal(t.amount).lt(0),
                        )
                        .map((t) => t.amount),
                    ),
                  ).abs(),
                )}
              </span>
            </div>
          ))
        ) : (
          <Empty text="Кассовые данные доступны владельцу и кассиру" />
        )}
      </div>
      <p className="hint mt">
        Экспорт CSV и Excel предусмотрен следующим этапом. Дата фильтрует
        заключение договоров и фактические операции; задолженность
        рассчитывается на сегодня.
      </p>
    </>
  );
}
function Cabinet({ data }: { data: State }) {
  const m = metrics(data);
  const next = data.payment_schedules.find((x) =>
    new Decimal(scheduleRemaining(data, x.id, x.amount)).gt(0),
  );
  return (
    <>
      <Heading
        title="Мои договоры"
        sub="Ваши условия, график и зарегистрированные поступления"
      />
      <div className="stats">
        <div className="card stat emerald">
          <div className="stat-label">Остаток задолженности</div>
          <div className="stat-value">{money(m.debt, true)}</div>
          <div className="stat-foot">Фиксированная цена без начислений</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Ближайший неоплаченный платёж</div>
          <div className="stat-value">
            {next
              ? money(scheduleRemaining(data, next.id, next.amount), true)
              : "—"}
          </div>
          <div className="stat-foot">
            {next
              ? dt(next.due_on)
              : data.contracts.length
                ? "Всё оплачено"
                : "Появится после оформления договора"}
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">Получено</div>
          <div className="stat-value">{money(m.received, true)}</div>
          <div className="stat-foot">По данным продавца</div>
        </div>
      </div>
      {data.contracts.map((c) => (
        <section key={c.id} className="stack mb">
          <div className="card pad">
            <div className="row between wrap">
              <div>
                <h3>{c.number}</h3>
                <p className="muted mt">
                  {
                    data.contract_items.find((x) => x.contract_id === c.id)
                      ?.product_name
                  }
                </p>
              </div>
              <a
                className="btn btn-outline"
                href={"/api/contracts/" + c.id + "/pdf"}
              >
                <Download size={16} />
                Скачать договор
              </a>
            </div>
            <div className="progress-track mt">
              <div
                className="progress-fill"
                style={{
                  width:
                    new Decimal(contractPaid(data, c.id))
                      .div(c.sale_price)
                      .mul(100)
                      .toNumber() + "%",
                }}
              />
            </div>
            <div className="row between">
              <small className="muted">
                Получено {money(contractPaid(data, c.id))}
              </small>
              <small>Цена {money(c.sale_price)}</small>
            </div>
          </div>
          <ScheduleTable data={data} contract={c} />
          <PaymentTable
            data={data}
            payments={data.payments.filter((p) => p.contract_id === c.id)}
          />
        </section>
      ))}
      <p className="hint mt">
        Онлайн-оплата не подключена. Сообщения об оплате проверяет продавец.
        Если заметили ошибку, обратитесь к продавцу.
      </p>
    </>
  );
}
