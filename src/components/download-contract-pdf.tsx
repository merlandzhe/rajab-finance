"use client";
import { useState } from "react";

export function DownloadContractPdf({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function savePdf() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Fetch using the Telegram Mini App's authenticated session.
      // Opening a protected URL in Safari may otherwise lose login cookies.
      const response = await fetch("/api/contracts/" + id + "/pdf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Не удалось получить договор. Обновите страницу.");
      const blob = await response.blob();
      if (blob.size < 100 || !blob.type.includes("pdf")) {
        throw new Error("Сервер не вернул PDF");
      }
      const filename = "HESAP-" + id.slice(0, 8) + ".pdf";
      const file = new File([blob], filename, { type: "application/pdf" });
      const sharing = { files: [file], title: "Договор рассрочки HESAP" };
      if (navigator.canShare?.(sharing)) {
        try {
          await navigator.share(sharing);
          return;
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return;
          // Browsers that disallow sharing after a download still allow
          // the standard local file save fallback.
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скачать договор");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void savePdf()} disabled={busy} className="cv-pdf-button">
        {busy ? "Подготавливаем PDF…" : "Сохранить или поделиться PDF"}
      </button>
      {error && <p role="alert" style={{ color: "#98402d", fontSize: 13 }}>{error}</p>}
    </>
  );
}
