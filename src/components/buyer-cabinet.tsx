"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import Decimal from "decimal.js";
import {
  Home,
  ShoppingBag,
  Wallet,
  UserRound,
  ArrowUpRight,
  FileText,
  Bell,
  Check,
  Clock,
  RefreshCw,
  ChevronLeft,
} from "lucide-react";
import type { Session, State } from "@/lib/types";
import {
  contractDebt,
  contractPaid,
  metrics,
  scheduleRemaining,
} from "@/lib/metrics";
import { money, today } from "@/lib/money";
import { ClientActions } from "./client-actions";
import { Brand } from "./brand";
import { PaymentMethods } from "./payment-methods";
import { ShopContact } from "./shop-contact";
import { payableContracts } from "@/lib/payment-eligibility";
import {
  matchesPeriod,
  scheduleOverview,
  type PaymentPeriod,
} from "@/lib/cabinet-overview";
import { FilterChips } from "./filter-chips";
type Run = (
  action: string,
  payload: unknown,
  notice?: string,
) => Promise<{ id: string } | null>;
const tabs = [
  ["home", "Главная", Home],
  ["applications", "Заявки", ShoppingBag],
  ["payments", "Платежи", Wallet],
  ["profile", "Профиль", UserRound],
] as const;
const date = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
export function BuyerCabinet({
  data,
  session,
  run,
  busy,
  reload,
}: {
  data: State;
  session: Session;
  run: Run;
  busy: boolean;
  reload: () => Promise<void>;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const requested = search.get("view");
  const tab =
    requested &&
    ["home", "applications", "payments", "profile", "notifications"].includes(
      requested,
    )
      ? requested
      : "home";
  function setTab(value: string, contract?: string) {
    const query = new URLSearchParams({ view: value });
    if (contract) query.set("contract", contract);
    const url = "/cabinet?" + query.toString();
    if (window.location.pathname + window.location.search !== url) {
      window.history.pushState(null, "", url);
    }
    window.scrollTo({ top: 0 });
  }
  const [period, setPeriod] = useState<PaymentPeriod>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  // A tab only selects a view of this authenticated snapshot. Refresh a
  // long-lived session in the background, including returns from Telegram.
  const lastFresh = useRef(Date.now());
  useEffect(() => {
    lastFresh.current = Date.now();
  }, [data]);
  useEffect(() => {
    function refreshIfStale() {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastFresh.current < 30_000
      )
        return;
      lastFresh.current = Date.now();
      router.refresh();
    }
    refreshIfStale();
    document.addEventListener("visibilitychange", refreshIfStale);
    return () =>
      document.removeEventListener("visibilitychange", refreshIfStale);
  }, [router, tab]);
  const day = today();
  const m = useMemo(() => metrics(data), [data, day]);
  const schedules = useMemo(() => scheduleOverview(data, day), [data, day]);
  const selectedContract = data.contracts.find(
    (c) => c.id === search.get("contract"),
  );
  const contractSchedules = schedules.filter(
    (p) => !selectedContract || p.contract_id === selectedContract.id,
  );
  const visibleSchedules = contractSchedules.filter((p) =>
    matchesPeriod(p, period),
  );
  const next = schedules.find((p) => !p.paid);
  const pendingClaims = data.payment_claims.filter(
    (p) => p.status === "pending",
  );
  const clarification = data.applications.filter(
    (a) => a.status === "clarification",
  );
  const eligibleContracts = payableContracts(data);
  const paymentTenant = selectedContract
    ? eligibleContracts.some((c) => c.id === selectedContract.id)
      ? selectedContract.tenant_id
      : undefined
    : new Set(eligibleContracts.map((c) => c.tenant_id)).size === 1
      ? eligibleContracts[0]?.tenant_id
      : undefined;
  return (
    <div className="buyer-app">
      <header className="pocket-header">
        <Brand href="/cabinet" />
        <button
          className="icon-button"
          aria-label="Уведомления"
          onClick={() => {
            setTab("notifications");
            window.scrollTo({ top: 0 });
          }}
        >
          <Bell size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Обновить данные"
          disabled={busy || refreshing}
          onClick={async () => {
            setRefreshing(true);
            setNotice("");
            try {
              await reload();
              setNotice("Данные обновлены");
            } catch {
              setNotice("Не удалось обновить данные. Попробуйте ещё раз.");
            } finally {
              setRefreshing(false);
            }
          }}
        >
          <RefreshCw size={18} className={refreshing ? "is-refreshing" : ""} />
        </button>
      </header>
      <main className="pocket-content">
        {notice && (
          <p role="status" className="hint">
            {notice}
          </p>
        )}
        {tab === "home" && (
          <>
            <div className="pocket-heading">
              <span className="eyebrow">Личный кабинет</span>
              <h1>
                Здравствуйте,
                <br />
                {session.name.split(" ")[0] || "покупатель"}.
              </h1>
              <p className="muted">Ваши покупки. Ясные условия.</p>
            </div>
            <section className="balance-card">
              <span>Осталось выплатить</span>
              <strong>{money(m.debt)}</strong>
              <div className="balance-footer">
                <div>
                  <small>
                    {next?.overdue ? "Просроченный платёж" : "Следующий платёж"}
                  </small>
                  <b>
                    {next
                      ? `${date(next.due_on)} · ${money(scheduleRemaining(data, next.id, next.amount))}`
                      : data.contracts.length
                        ? "Всё оплачено"
                        : "Платежей пока нет"}
                  </b>
                </div>
                <button
                  aria-label="Открыть платежи"
                  onClick={() => setTab("payments", next?.contract_id)}
                >
                  <ArrowUpRight size={22} />
                </button>
              </div>
            </section>
            {clarification.length > 0 && (
              <button
                className="attention-card full"
                onClick={() => setTab("applications")}
              >
                <ShoppingBag size={22} />
                <div>
                  <strong>
                    Нужно уточнить заявку · {clarification.length}
                  </strong>
                  <small>Предприниматель ждёт вашего ответа</small>
                </div>
                <ArrowUpRight size={18} />
              </button>
            )}
            {pendingClaims.length > 0 && (
              <button
                className="attention-card full"
                onClick={() => setTab("payments")}
              >
                <Clock size={22} />
                <div>
                  <strong>Оплата на проверке · {pendingClaims.length}</strong>
                  <small>Долг изменится после подтверждения продавцом</small>
                </div>
                <ArrowUpRight size={18} />
              </button>
            )}
            <button
              className="btn btn-primary full"
              onClick={() => router.push("/cabinet/setup?mode=application")}
            >
              Оформить рассрочку <ArrowUpRight size={17} />
            </button>
            <div className="section-title">
              <h2>Мои рассрочки</h2>
              <span>{data.contracts.length}</span>
            </div>
            {!data.contracts.length && (
              <div className="pocket-empty">
                <ShoppingBag size={30} />
                <h3>Ваша первая покупка</h3>
                <p>
                  Выберите предпринимателя и отправьте заявку. После оформления
                  здесь появятся договор и график.
                </p>
                <Link prefetch={false} href="/cabinet/setup?mode=application">
                  Оформить рассрочку →
                </Link>
              </div>
            )}
            {data.contracts.map((c) => (
              <article key={c.id} className="purchase-card">
                <div className="row between">
                  <span className="product-icon">
                    <ShoppingBag size={22} />
                  </span>
                  <span className="badge neutral">
                    {new Decimal(contractDebt(data, c)).gt(0)
                      ? "Активна"
                      : "Оплачена"}
                  </span>
                </div>
                <h3>
                  {data.contract_items.find((i) => i.contract_id === c.id)
                    ?.product_name ?? c.number}
                </h3>
                <p className="muted">
                  {c.months} мес. · {c.number}
                </p>
                <ShopContact
                  shop={data.seller_directory?.find(
                    (s) => s.tenant_id === c.tenant_id,
                  )}
                />
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width:
                        Decimal.min(
                          100,
                          new Decimal(contractPaid(data, c.id))
                            .div(c.sale_price)
                            .mul(100),
                        ).toNumber() + "%",
                    }}
                  />
                </div>
                <div className="row between">
                  <small>Оплачено {money(contractPaid(data, c.id))}</small>
                  <small>из {money(c.sale_price)}</small>
                </div>
                <div className="row mt">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setPeriod("all");
                      setTab("payments", c.id);
                    }}
                  >
                    График и оплата
                  </button>
                  <a
                    className="icon-button"
                    aria-label={`Скачать договор ${c.number}`}
                    href={`/api/contracts/${c.id}/pdf`}
                  >
                    <FileText size={20} />
                  </a>
                </div>
              </article>
            ))}
          </>
        )}
        {tab === "applications" && (
          <>
            <div className="pocket-heading">
              <span className="eyebrow">Покупки в рассрочку</span>
              <h1>Мои заявки</h1>
              <Link
                prefetch={false}
                href="/cabinet/setup?mode=seller"
                className="seller-switch"
              >
                {session.tenant_id
                  ? `${data.organizations[0]?.name ?? "Предприниматель"} · сменить →`
                  : "Новая заявка →"}
              </Link>
            </div>
            {session.tenant_id ? (
              <ClientActions
                data={data}
                run={run}
                busy={busy}
                view="applications"
              />
            ) : (
              <div className="pocket-empty">
                <ShoppingBag size={28} />
                <h3>Заявок пока нет</h3>
                <p>
                  Выберите товар и предпринимателя при оформлении первой
                  рассрочки.
                </p>
                <Link
                  prefetch={false}
                  className="btn btn-primary full mt"
                  href="/cabinet/setup?mode=application"
                >
                  Оформить рассрочку
                </Link>
              </div>
            )}
            <ShopContact
              shop={data.seller_directory?.find(
                (s) => s.tenant_id === session.tenant_id,
              )}
            />
          </>
        )}
        {tab === "payments" && (
          <>
            <div className="pocket-heading">
              <span className="eyebrow">Всё под контролем</span>
              <h1>Платежи</h1>
            </div>
            {data.contracts.length > 1 && (
              <label className="field contract-picker">
                Рассрочка
                <select
                  value={selectedContract?.id ?? ""}
                  onChange={(e) => {
                    setPeriod("all");
                    setTab("payments", e.target.value);
                  }}
                >
                  <option value="">Все рассрочки</option>
                  {data.contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {data.contract_items.find((i) => i.contract_id === c.id)
                        ?.product_name ?? c.number}{" "}
                      · {c.number}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedContract && (
              <div className="payment-context">
                <strong>
                  {data.contract_items.find(
                    (i) => i.contract_id === selectedContract.id,
                  )?.product_name ?? selectedContract.number}
                </strong>
                <span>
                  Остаток {money(contractDebt(data, selectedContract))}
                </span>
              </div>
            )}
            {contractSchedules.length > 0 && (
              <FilterChips
                label="Статус платежей"
                value={period}
                onChange={setPeriod}
                options={[
                  {
                    value: "all",
                    label: "К оплате",
                    count: contractSchedules.filter((p) => !p.paid).length,
                  },
                  {
                    value: "paid",
                    label: "Оплачены",
                    count: contractSchedules.filter((p) => p.paid).length,
                  },
                  {
                    value: "overdue",
                    label: "Просрочены",
                    count: contractSchedules.filter((p) => p.overdue).length,
                  },
                ]}
              />
            )}
            {!schedules.length && (
              <div className="pocket-empty">
                <Wallet size={30} />
                <h3>График появится здесь</h3>
                <p>
                  Предприниматель оформит договор после согласования вашей
                  заявки.
                </p>
              </div>
            )}
            {contractSchedules.length > 0 && !visibleSchedules.length && (
              <p className="hint">
                {period === "paid"
                  ? "Подтверждённых платежей пока нет."
                  : period === "overdue"
                    ? "Просроченных платежей нет."
                    : "Все платежи по этому графику оплачены."}
              </p>
            )}
            {visibleSchedules.length > 0 && (
              <div className="schedule-list">
                {visibleSchedules.map((p) => {
                  const remaining = scheduleRemaining(data, p.id, p.amount);
                  const paid = new Decimal(remaining).lte(0);
                  const late = !paid && p.due_on < today();
                  return (
                    <div
                      key={p.id}
                      className={"schedule-item " + (late ? "is-overdue" : "")}
                    >
                      <span
                        className={"schedule-mark " + (paid ? "is-paid" : "")}
                      >
                        {paid ? <Check size={18} /> : <Clock size={18} />}
                      </span>
                      <div>
                        <strong>
                          {p.sequence === 0
                            ? "Первый взнос"
                            : `${p.sequence} платёж`}
                        </strong>
                        <small>
                          {date(p.due_on)} ·{" "}
                          {
                            data.contracts.find((c) => c.id === p.contract_id)
                              ?.number
                          }
                        </small>
                        <small>
                          {paid ? "Оплачен" : late ? "Просрочен" : "К оплате"}
                        </small>
                      </div>
                      <b>{money(paid ? p.amount : remaining)}</b>
                    </div>
                  );
                })}
              </div>
            )}
            {paymentTenant && paymentTenant === session.tenant_id && (
              <PaymentMethods key={paymentTenant} tenantId={paymentTenant} />
            )}
            {!selectedContract &&
              new Set(eligibleContracts.map((c) => c.tenant_id)).size > 1 && (
                <p className="hint">
                  Выберите рассрочку, чтобы увидеть реквизиты её продавца.
                </p>
              )}
            <ClientActions
              key={selectedContract?.id ?? "all"}
              data={data}
              run={run}
              busy={busy}
              view="payments"
              contractId={selectedContract?.id}
            />
          </>
        )}
        {tab === "profile" && (
          <>
            <div className="pocket-heading">
              <span className="eyebrow">Ваш аккаунт</span>
              <h1>Профиль</h1>
            </div>
            <div className="purchase-card">
              <UserRound size={28} />
              <h2>{session.name}</h2>
              <p className="muted">{data.organizations[0]?.name}</p>
              <Link
                prefetch={false}
                className="btn btn-outline full mt"
                href="/cabinet/setup?mode=profile"
              >
                Изменить профиль <ArrowUpRight size={16} />
              </Link>
            </div>
          </>
        )}
        {tab === "notifications" && (
          <>
            <button
              className="back-link inline-back"
              onClick={() => setTab("home")}
            >
              <ChevronLeft size={18} /> На главную
            </button>
            <div className="pocket-heading">
              <span className="eyebrow">HESAP</span>
              <h1>Уведомления</h1>
            </div>
            <section className="purchase-card">
              <Bell className="gold" />
              <h3>Уведомления в Telegram</h3>
              <p className="muted">
                Статус заявки, подтверждение оплаты и напоминания о сроках.
              </p>
              <button
                className="btn btn-primary full mt"
                onClick={() => {
                  const app = window.Telegram?.WebApp;
                  if (app?.requestWriteAccess)
                    app.requestWriteAccess((ok) =>
                      setNotice(
                        ok
                          ? "Сообщения разрешены. Уведомления будут приходить в Telegram."
                          : "Разрешение не получено.",
                      ),
                    );
                  else
                    setNotice(
                      "Откройте приложение через Telegram, чтобы разрешить сообщения.",
                    );
                }}
              >
                Разрешить сообщения
              </button>
            </section>
          </>
        )}
      </main>
      <nav className="pocket-nav" aria-label="Кабинет покупателя">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            className={tab === key ? "active" : ""}
            onClick={() => {
              setTab(key);
              window.scrollTo({ top: 0 });
            }}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
