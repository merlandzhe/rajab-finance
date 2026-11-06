"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
export function TelegramInvite({
  customerId,
  hasAccount = true,
}: {
  customerId?: string;
  hasAccount?: boolean;
}) {
  const [invite, setInvite] = useState<{
    code: string;
    url: string;
    expires_at: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [linked,setLinked]=useState<boolean|null>(null);
  useEffect(()=>{
    if(customerId) return;
    let active=true;
    fetch("/api/telegram/invite").then(async r=>{
      if(!r.ok) throw new Error();
      const d=await r.json(); if(active)setLinked(d.linked===true);
    }).catch(()=>{if(active)setLinked(null);});
    return()=>{active=false;};
  },[customerId]);
  async function change(cancel = false) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/telegram/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, cancel }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setInvite(cancel ? null : d);
      if (cancel) setMessage("Неиспользованное приглашение отменено.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Не удалось создать приглашение",
      );
    } finally {
      setBusy(false);
    }
  }
  if(!customerId && linked!==false) return null;
  return (
    <section className="card pad mb telegram-invite">
      <h3>
        {customerId ? "Кабинет клиента в Telegram" : "Мой кабинет в Telegram"}
      </h3>
      <p className="muted mt">
        {customerId
          ? "Создайте персональную ссылку и передайте её этому клиенту после проверки его личности."
          : "Откройте персональную ссылку со своего Telegram, чтобы привязать этот кабинет."}
      </p>
      {!hasAccount ? (
        <p className="hint mt">
          Сначала администратор должен создать учётную запись клиента и связать
          её с этой карточкой.
        </p>
      ) : (
        <>
          <div className="row mt">
            <Button disabled={busy} onClick={() => change()}>
              {invite ? "Создать новую ссылку" : "Создать приглашение"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => change(true)}
            >
              Отменить приглашение
            </Button>
          </div>
          {invite && (
            <div className="mt">
              <label className="field">
                Персональный код
                <textarea
                  readOnly
                  value={invite.code}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <label className="field">
                Персональная ссылка
                <textarea
                  readOnly
                  value={invite.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <p className="hint">
                Одноразовая ссылка действует до{" "}
                {new Date(invite.expires_at).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . Не публикуйте её в общих чатах. Новая ссылка отменяет
                предыдущую.
              </p>
              <Button
                variant="outline"
                className="mt"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invite.url);
                    setMessage("Ссылка скопирована.");
                  } catch {
                    setMessage(
                      "Выделите ссылку в поле выше и скопируйте вручную.",
                    );
                  }
                }}
              >
                Скопировать ссылку
              </Button>
            </div>
          )}
        </>
      )}
      {message && (
        <p className="hint mt" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
