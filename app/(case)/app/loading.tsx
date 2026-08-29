export default function CasesLoading() {
  return (
    <main className="gb-container py-8 sm:py-12" aria-busy="true" aria-labelledby="cases-loading-title">
      <p className="gb-eyebrow">Case workspace</p>
      <h1 id="cases-loading-title" className="gb-display mt-3 text-4xl font-semibold text-harbor-deep">
        Loading your cases
      </h1>
      <p className="mt-3 text-muted-foreground" role="status" aria-live="polite">
        Checking the cases available to this account…
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2" aria-hidden="true">
        {[0, 1].map((item) => (
          <div key={item} className="gb-card min-h-40 animate-pulse bg-harbor-surface-subtle p-5" />
        ))}
      </div>
    </main>
  )
}
