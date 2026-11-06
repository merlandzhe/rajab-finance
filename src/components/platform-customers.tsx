"use client";
import { useEffect, useState } from "react";
import { Search, UserRound, Phone, MapPin, Store } from "lucide-react";
import { ArchiveAction } from "./archive-action";
type Customer = {
  id: string;
  name: string;
  phone: string | null;
  city: string;
  companies: string[];
  created_at: string;
};
export function PlatformCustomers() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    fetch(
      `/api/platform/customers?q=${encodeURIComponent(query)}&offset=${offset}&archived=${archived}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw Error("Не удалось загрузить клиентов");
        return r.json();
      })
      .then(setRows)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [query, offset, retry, archived]);
  return (
    <section className="clean-section">
      <div className="screen-heading">
        <span className="eyebrow">Владелец HESAP</span>
        <h1>Клиенты</h1>
        <p className="muted">Профили покупателей и их магазины</p>
      </div>
      <form
        className="directory-toolbar directory-search"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setQuery(draft.trim());
        }}
      >
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            id="platform-client-search"
            aria-label="Поиск клиентов"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Имя, телефон или компания"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Найти
        </button>
      </form>
      <div className="segmented mb">
        <button
          type="button"
          aria-pressed={!archived}
          className={!archived ? "active" : ""}
          onClick={() => {
            setArchived(false);
            setOffset(0);
          }}
        >
          Действующие
        </button>
        <button
          type="button"
          aria-pressed={archived}
          className={archived ? "active" : ""}
          onClick={() => {
            setArchived(true);
            setOffset(0);
          }}
        >
          Удалённые
        </button>
      </div>
      {busy ? (
        <p role="status">Загружаем клиентов…</p>
      ) : error ? (
        <div className="error" role="alert">
          {error}
          <button className="btn mt" onClick={() => setRetry((x) => x + 1)}>
            Повторить
          </button>
        </div>
      ) : (
        <>
          {rows.length === 0 && (
            <div className="card pad">
              {query
                ? "По вашему запросу клиентов нет."
                : archived
                  ? "Удалённых клиентов нет."
                  : "Клиенты пока не зарегистрированы."}
            </div>
          )}
          {rows.slice(0, 50).map((c) => (
            <article key={c.id} className="card directory-card mb">
              <div className="entity-heading">
                <span className="entity-icon">
                  <UserRound size={21} aria-hidden="true" />
                </span>
                <div className="entity-title">
                  <h3>{c.name || "Профиль не заполнен"}</h3>
                  {c.city && (
                    <p>
                      <MapPin size={13} aria-hidden="true" />
                      {c.city}
                    </p>
                  )}
                </div>
              </div>
              <div className="record-contacts">
                {c.phone ? (
                  <a href={"tel:" + c.phone}>
                    <Phone size={15} aria-hidden="true" />
                    {c.phone}
                  </a>
                ) : (
                  <span>Телефон не указан</span>
                )}
              </div>
              <div className="record-detail">
                <Store size={15} aria-hidden="true" />
                <span>
                  {c.companies.length
                    ? c.companies.join(" · ")
                    : "Магазин ещё не выбран"}
                </span>
              </div>
              <details className="card-details">
                <summary>Карточка клиента</summary>
                <p className="muted">
                  В HESAP с {new Date(c.created_at).toLocaleDateString("ru-RU")}
                </p>
                <ArchiveAction
                  target={c.id}
                  name={c.name}
                  archived={archived}
                  onDone={() => setRetry((x) => x + 1)}
                />
              </details>
            </article>
          ))}
          {(offset > 0 || rows.length > 50) && (
            <div className="actions">
              <button
                className="btn"
                disabled={offset === 0}
                onClick={() => setOffset((x) => Math.max(0, x - 50))}
              >
                Назад
              </button>
              <button
                className="btn"
                disabled={rows.length <= 50}
                onClick={() => setOffset((x) => x + 50)}
              >
                Далее
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
