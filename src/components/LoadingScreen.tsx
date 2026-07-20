export function LoadingScreen({
  fullscreen = false,
  label = "Loading…",
}: {
  fullscreen?: boolean;
  label?: string;
}) {
  return (
    <main
      className={`app-loading-screen${fullscreen ? " is-fullscreen" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="app-loading-content">
        <span className="app-loading-spinner" aria-hidden="true" />
        <span className="app-loading-label">{label}</span>
      </div>
    </main>
  );
}
