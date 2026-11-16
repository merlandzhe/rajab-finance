export default function Loading() {
  return (
    <main className="app-body" aria-busy="true">
      <div className="directory-loading" role="status">
        <span>Открываем раздел…</span>
        <div aria-hidden="true" />
      </div>
    </main>
  );
}
