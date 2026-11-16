"use client";
import { useEffect, useRef, useState } from "react";
import {
  Store,
  ShoppingBag,
  Search,
  RefreshCw,
  Phone,
  Send,
  CalendarDays,
  Link2,
  Inbox,
} from "lucide-react";
import { ArchiveAction } from "./archive-action";
import { PlatformMerchants } from "./platform-merchants";
import { FilterChips } from "./filter-chips";
import { companyAccessCategory, matchesSearch } from "@/lib/cabinet-overview";
type Company = {
  id: string;
  name: string;
  status: string;
  expires_at: string | null;
  linked: boolean;
  archived: boolean;
};
type RequestRow = {
  id: string;
  name: string;
  shop_name: string;
  city: string;
  phone: string;
  telegram_id: number;
  username: string | null;
  status: string;
};
export type AccessState = {
  requests: RequestRow[];
  companies: Company[];
  codes: {
    id: string;
    tenant_id: string;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
  }[];
  delivery: { pending: number; failed: number; waiting_connection?: number };
};
const statusName: Record<string, string> = {
  new: "Новая",
  review: "На рассмотрении",
  approved: "Код выдан",
  rejected: "Отклонена",
  activated: "Подключён",
  pending: "Ожидает активации",
  active: "Доступ открыт",
  blocked: "Заблокирована",
  ending: "Скоро продление",
  expired: "Подписка закончилась",
  archived: "Удалена",
};
export function PlatformAccess({
  view = "companies",
  initialAccess,
}: {
  view?: "requests" | "companies" | "notifications";
  initialAccess?: AccessState;
}) {
  const [data, setData] = useState<AccessState | null>(initialAccess ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [code, setCode] = useState<{ code: string; expires_at: string } | null>(
      null,
    ),
    [filter, setFilter] = useState("current"),
    [search, setSearch] = useState("");
  const tab = view;
  const pending = useRef(false);
  const codePanel = useRef<HTMLDivElement>(null);
  const codeField = useRef<HTMLTextAreaElement>(null);
  const [copyNotice, setCopyNotice] = useState("");
  useEffect(() => {
    setCopyNotice("");
    if (code) {
      codePanel.current?.focus({ preventScroll: true });
      codePanel.current?.scrollIntoView({ block: "start" });
    }
  }, [code]);
  useEffect(() => {
    setFilter("current");
    setSearch("");
    setCode(null);
  }, [view]);
  async function load() {
    const r = await fetch("/api/platform/access", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    if (initialAccess) setData(initialAccess);
    else load().catch((e) => setError(e.message));
  }, [initialAccess]);
  async function act(body: unknown) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/platform/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.code) setCode(d);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const now = Date.now();
  const companyMatches = (c: Company, value: string) => {
    const category = companyAccessCategory(c, now);
    if (value === "current") return !c.archived;
    if (value === "renewal") return ["ending", "expired"].includes(category);
    return category === value;
  };
  const requestMatches = (r: RequestRow, value: string) =>
    value === "all" ||
    (value === "current"
      ? ["new", "review"].includes(r.status)
      : r.status === "approved");
  const companies = (data?.companies ?? []).filter(
    (c) => companyMatches(c, filter) && matchesSearch(search, [c.name]),
  );
  const requests = (data?.requests ?? []).filter(
    (r) =>
      requestMatches(r, filter) &&
      matchesSearch(search, [r.name, r.shop_name, r.phone, r.city, r.username]),
  );
  const filters =
    view === "companies"
      ? [
          { value: "current", label: "Все компании" },
          { value: "renewal", label: "Продлить" },
          { value: "blocked", label: "Заблокированы" },
          { value: "archived", label: "Удалённые" },
        ]
      : [
          { value: "current", label: "Новые" },
          { value: "approved", label: "Ждут активации" },
          { value: "all", label: "Все заявки" },
        ];
  return (
    <section className="platform-access clean-section">
      <header className="screen-heading">
        <span className="eyebrow">Владелец HESAP</span>
        <h1>
          {view === "requests"
            ? "Заявки"
            : view === "companies"
              ? "Компании"
              : "Уведомления"}
        </h1>
        <p className="muted">
          {view === "requests"
            ? "Новые подключения и активация кабинетов"
            : view === "companies"
              ? "Магазины, доступы и сроки подписок"
              : "Отправка сообщений и состояние доставки"}
        </p>
      </header>
      {view !== "notifications" && data && (
        <FilterChips
          label={
            view === "companies" ? "Состояние компаний" : "Состояние заявок"
          }
          value={filter}
          onChange={setFilter}
          options={filters.map((f) => ({
            ...f,
            count:
              view === "companies"
                ? data.companies.filter((c) => companyMatches(c, f.value))
                    .length
                : data.requests.filter((r) => requestMatches(r, f.value))
                    .length,
          }))}
        />
      )}
      {view !== "notifications" && (
        <div className="directory-toolbar directory-search">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Поиск"
              placeholder={
                view === "companies"
                  ? "Найти компанию"
                  : "Магазин, имя, телефон"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-outline refresh-button"
            aria-label="Обновить список"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={busy ? "is-refreshing" : ""}
            />
            <span>{busy ? "Обновляем…" : "Обновить"}</span>
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <div className="directory-loading" role="status">
          <span>Загружаем данные…</span>
          <div aria-hidden="true" />
          <div aria-hidden="true" />
        </div>
      )}
      {code && (
        <div
          className="card pad mb activation-receipt"
          ref={codePanel}
          tabIndex={-1}
        >
          <h2>Код активации</h2>
          <p>
            Передайте код лично заявителю. Его сможет использовать только
            Telegram из заявки.
          </p>
          <textarea
            ref={codeField}
            aria-label="Код активации"
            onFocus={(e) => e.currentTarget.select()}
            readOnly
            value={code.code}
            rows={2}
          />
          <p className="muted">
            До {new Date(code.expires_at).toLocaleString("ru-RU")}
          </p>
          <button
            type="button"
            className="btn btn-primary full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code.code);
                setCopyNotice("Код скопирован");
              } catch {
                codeField.current?.focus();
                codeField.current?.select();
                setCopyNotice(
                  "Текст выделен. Нажмите и удерживайте поле, затем выберите «Скопировать».",
                );
              }
            }}
          >
            Скопировать код
          </button>
          {copyNotice && <p role="status">{copyNotice}</p>}
          <button className="btn btn-outline mt" onClick={() => setCode(null)}>
            Скрыть код
          </button>
        </div>
      )}
      {tab === "requests" && data && (
        <div className="stack">
          {!requests.length && (
            <div className="card directory-empty">
              <Inbox size={28} aria-hidden="true" />
              <h2>
                {search || filter !== "current"
                  ? "Заявки не найдены"
                  : "Новых заявок пока нет"}
              </h2>
              <p>
                {search
                  ? "Измените поиск или выберите другой статус."
                  : "Предприниматели могут оставить заявку через «Получить доступ»."}
              </p>
            </div>
          )}
          {requests.map((r) => (
            <article className="card directory-card" key={r.id}>
              <div className="entity-heading">
                <span className="entity-icon">
                  <ShoppingBag size={21} aria-hidden="true" />
                </span>
                <div className="entity-title">
                  <h2>{r.shop_name}</h2>
                  <p>
                    {r.name}
                    {r.city ? ` · ${r.city}` : ""}
                  </p>
                </div>
              </div>
              <div className="record-status">
                <span className={"access-state request-" + r.status}>
                  {statusName[r.status]}
                </span>
              </div>
              <div className="record-contacts">
                <a href={"tel:" + r.phone}>
                  <Phone size={15} aria-hidden="true" />
                  {r.phone}
                </a>
                {r.username ? (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={"https://t.me/" + r.username}
                  >
                    <Send size={15} aria-hidden="true" />@{r.username}
                  </a>
                ) : (
                  <span className="record-reference">
                    Telegram ID <b>{r.telegram_id}</b>
                  </span>
                )}
              </div>
              {r.status !== "activated" && (
                <details className="card-details">
                  <summary>Рассмотреть заявку</summary>
                  <form
                    className="stack mt"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({
                        action: "issue",
                        id: r.id,
                        days: Number(new FormData(e.currentTarget).get("days")),
                      });
                    }}
                  >
                    <label className="field">
                      Доступ после активации, дней
                      <input
                        name="days"
                        type="number"
                        defaultValue={30}
                        min={1}
                        max={3660}
                        required
                      />
                    </label>
                    <button disabled={busy} className="btn btn-primary">
                      {r.status === "approved"
                        ? "Перевыпустить код"
                        : "Одобрить и выдать код"}
                    </button>
                    {r.status !== "approved" && (
                      <div className="row">
                        <button
                          disabled={busy}
                          type="button"
                          className="btn btn-outline"
                          onClick={() =>
                            void act({
                              action: "status",
                              id: r.id,
                              status: "review",
                            })
                          }
                        >
                          Рассмотреть
                        </button>
                        <button
                          disabled={busy}
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            void act({
                              action: "status",
                              id: r.id,
                              status: "rejected",
                            })
                          }
                        >
                          Отклонить
                        </button>
                      </div>
                    )}
                  </form>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
      {tab === "companies" && data && (
        <div className="stack">
          {!companies.length && (
            <div className="card directory-empty">
              <Store size={28} aria-hidden="true" />
              <h3>
                {filter === "archived"
                  ? "Удалённых компаний нет"
                  : filter === "renewal" && !search
                    ? "Продление пока не требуется"
                    : "Компании не найдены"}
              </h3>
              <p className="muted">
                {search
                  ? "Попробуйте другое название."
                  : filter === "renewal"
                    ? "Здесь будут подписки, которые истекли или заканчиваются в ближайшие 7 дней."
                    : "Новые подключения появятся в разделе «Заявки»."}
              </p>
            </div>
          )}
          {companies.map((c) => (
            <article className="card directory-card" key={c.id}>
              <div className="entity-heading">
                <span className="entity-icon">
                  <Store size={21} aria-hidden="true" />
                </span>
                <div className="entity-title">
                  <h2>{c.name}</h2>
                  <p>Кабинет предпринимателя</p>
                </div>
              </div>
              <div className="record-status">
                <span
                  className={
                    "access-state access-" + companyAccessCategory(c, now)
                  }
                >
                  {statusName[companyAccessCategory(c, now)]}
                </span>
              </div>
              <div className="record-detail">
                <Link2 size={15} aria-hidden="true" />
                <span>
                  {c.linked
                    ? "Telegram подключён"
                    : "Telegram ещё не подключён"}
                </span>
              </div>
              {!c.archived && (
                <p className="subscription-date record-detail">
                  <CalendarDays size={15} aria-hidden="true" />
                  <span>
                    {c.expires_at
                      ? "Доступ до " +
                        new Date(c.expires_at).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          timeZone: "Europe/Moscow",
                        })
                      : "Без ограничения срока"}
                  </span>
                </p>
              )}
              {!c.archived && (
                <details className="card-details">
                  <summary>Управление компанией</summary>
                  <CompanyAccess company={c} busy={busy} save={act} />
                  {!c.linked && (
                    <details className="card-details">
                      <summary>Подключить владельца в Telegram</summary>
                      <PlatformMerchants tenantId={c.id} />
                    </details>
                  )}
                  {data.codes
                    .filter(
                      (x) =>
                        x.tenant_id === c.id && !x.used_at && !x.revoked_at,
                    )
                    .map((x) => (
                      <div className="row between mt" key={x.id}>
                        <small>
                          Код{" "}
                          {new Date(x.expires_at) < new Date()
                            ? "истёк"
                            : "до " +
                              new Date(x.expires_at).toLocaleString("ru-RU")}
                        </small>
                        <button
                          disabled={busy}
                          className="btn btn-outline"
                          onClick={() =>
                            void act({ action: "revoke", id: x.id })
                          }
                        >
                          Отозвать
                        </button>
                      </div>
                    ))}
                  <ArchiveAction
                    target={"company:" + c.id}
                    name={c.name}
                    onDone={() => void load().catch((e) => setError(e.message))}
                  />
                </details>
              )}
              {c.archived && (
                <ArchiveAction
                  target={"company:" + c.id}
                  name={c.name}
                  archived
                  onDone={() => void load().catch((e) => setError(e.message))}
                />
              )}
            </article>
          ))}
        </div>
      )}
      {data && view === "notifications" && (
        <section className="card directory-card">
          <h2>Доставка в Telegram</h2>
          <p>
            В очереди: {data.delivery.pending}. Требуют внимания:{" "}
            {data.delivery.failed}.
          </p>
          <p className="muted">
            {data.delivery.waiting_connection ? "Ждут подключения Telegram: " + data.delivery.waiting_connection + ". Получателю нужно открыть бота и привязать свой кабинет." : "Здесь показано состояние отправки сообщений, а не личные непрочитанные уведомления."}
          </p>
          <button
            className="btn btn-outline"
            disabled={busy || !data.delivery.failed}
            onClick={() => void act({ action: "retry" })}
          >
            Повторить неудачные отправки
          </button>
        </section>
      )}
    </section>
  );
}
function CompanyAccess({
  company: c,
  busy,
  save,
}: {
  company: Company;
  busy: boolean;
  save: (b: unknown) => Promise<void>;
}) {
  const dateField = useRef<HTMLInputElement>(null);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const date = String(f.get("expires"));
        void save({
          action: "access",
          tenant_id: c.id,
          status: f.get("status"),
          expires_at: date
            ? new Date(date + "T23:59:59+03:00").toISOString()
            : null,
        });
      }}
    >
      <label className="field">
        Доступ до (по Москве)
        <input
          key={c.expires_at ?? "none"}
          ref={dateField}
          name="expires"
          type="date"
          defaultValue={
            c.expires_at
              ? new Date(c.expires_at).toLocaleDateString("en-CA", {
                  timeZone: "Europe/Moscow",
                })
              : ""
          }
        />
      </label>
      <div
        className="renewal-presets"
        role="group"
        aria-label="Быстрое продление"
      >
        {[30, 90, 365].map((days) => (
          <button
            key={days}
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() => {
              const input = dateField.current;
              if (!input) return;
              const parts = new Intl.DateTimeFormat("en", {
                timeZone: "Europe/Moscow",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).formatToParts(new Date());
              const part = (type: string) =>
                parts.find((p) => p.type === type)?.value;
              const today = `${part("year")}-${part("month")}-${part("day")}`;
              const date = new Date(
                (input.value > today ? input.value : today) + "T00:00:00Z",
              );
              date.setUTCDate(date.getUTCDate() + days);
              input.value = date.toISOString().slice(0, 10);
            }}
          >
            +{days} дней
          </button>
        ))}
      </div>
      <small className="muted">
        Дни добавляются к выбранной дате, а если срок истёк — к сегодняшней. Для
        применения нажмите «Сохранить доступ».
      </small>
      <small className="muted">
        Пустая дата — без ограничения срока. Изменение срока не означает
        получение оплаты.
      </small>
      <label className="field">
        Состояние
        <select
          name="status"
          key={c.status}
          defaultValue={c.status === "blocked" ? "blocked" : "active"}
        >
          <option value="active">Разрешён</option>
          <option value="blocked">Заблокирован</option>
        </select>
      </label>
      <button disabled={busy} className="btn btn-primary">
        Сохранить доступ
      </button>
    </form>
  );
}
