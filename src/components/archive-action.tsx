"use client";
import { useRef, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
export function ArchiveAction({
  target,
  name,
  archived,
  onDone,
}: {
  target: string;
  name: string;
  archived?: boolean;
  onDone: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={archived ? "btn btn-outline" : "btn btn-ghost danger-text"}
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        {archived ? <RotateCcw size={16} /> : <Trash2 size={16} />}{" "}
        {archived ? "Восстановить" : "Удалить"}
      </button>
      <dialog
        ref={dialog}
        className="hesap-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        aria-labelledby={`archive-${target}`}
      >
        <h2 id={`archive-${target}`}>
          {archived ? "Восстановить запись?" : "Удалить запись?"}
        </h2>
        <p>
          <strong>{name || "Клиент"}</strong>
        </p>
        <p>
          {archived
            ? "Запись вернётся в основной список. Для компании доступ и подписку нужно включить отдельно."
            : "Запись уйдёт в «Удалённые», доступ будет отключён. История сохранится, запись можно восстановить. При действующих договорах удаление недоступно."}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="action-pair">
          <button
            autoFocus
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Отмена
          </button>
          <button
            type="button"
            className={archived ? "btn btn-primary" : "btn btn-danger"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await fetch("/api/platform/archive", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    target,
                    restore: !!archived,
                    confirm: true,
                  }),
                });
                const d = await r.json();
                if (!r.ok)
                  throw Error(d.error || "Не удалось выполнить действие");
                dialog.current?.close();
                onDone();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Сохраняем…" : archived ? "Восстановить" : "Удалить"}
          </button>
        </div>
      </dialog>
    </>
  );
}
