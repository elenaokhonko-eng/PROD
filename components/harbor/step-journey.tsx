type JourneyStep = {
  title: string
  description: string
}

export function StepJourney({ steps }: { steps: readonly JourneyStep[] }) {
  return (
    <ol className="grid gap-5 lg:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="gb-card relative p-6 pt-16">
          <span
            className="absolute left-6 top-5 flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <h2 className="text-xl font-semibold text-harbor-deep">{step.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{step.description}</p>
        </li>
      ))}
    </ol>
  )
}
