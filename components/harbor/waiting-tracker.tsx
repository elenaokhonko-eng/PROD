const steps = [
  ['Submit through the official channel', 'GuideBuoy does not send a complaint on your behalf.'],
  ['Keep the acknowledgement', 'Save the organisation’s reference and messages with your own records.'],
  ['Check the official status', 'Use the organisation’s official channel for updates or requests.'],
  ['Review the next step', 'If the issue remains unresolved, check the current official escalation requirements.'],
] as const

export function WaitingTracker() {
  return (
    <section className="gb-card p-6" aria-labelledby="waiting-title">
      <h2 id="waiting-title" className="text-xl font-semibold text-harbor-deep">
        After preparing your information
      </h2>
      <p className="mt-2 leading-6 text-muted-foreground">
        Timelines and requirements vary. Check the receiving organisation’s official information before acting.
      </p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, description], index) => (
          <li key={title} className="rounded-xl border bg-card p-4">
            <span className="text-sm font-semibold text-primary">Step {index + 1}</span>
            <span className="mt-2 block font-semibold">{title}</span>
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
