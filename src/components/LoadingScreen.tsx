export function LoadingScreen({ label = "Loading…" }: { fullscreen?: boolean; label?: string }) {
  return <main className="route-skeleton" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="route-skeleton-heading" aria-hidden="true" />
    <div className="route-skeleton-grid" aria-hidden="true">
      {[0, 1, 2, 3].map(key => <div className="route-skeleton-card" key={key}><i /><b /><i /></div>)}
    </div>
  </main>;
}
