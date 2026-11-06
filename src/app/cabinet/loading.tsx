export default function LoadingCabinet() {
  return (
    <main className="app-body" aria-busy="true">
      <div className="directory-loading" role="status">
        <span>Открываем кабинет…</span>
        <div aria-hidden="true" />
      </div>
    </main>
  );
}
