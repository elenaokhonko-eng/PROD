import type { ReactNode } from 'react'

type JourneyStep = {
  title: string
  description: string
}

type StepJourneyProps = {
  steps: readonly JourneyStep[]
  // An action shown after this step (brief W1 §I: How it works repeats its primary button after step 4). The steps
  // continue in a second list that keeps the numbering.
  actionAfterStep?: number
  action?: ReactNode
}

function Steps({ steps, first, columns }: { steps: readonly JourneyStep[]; first: number; columns: string }) {
  return (
    <ol start={first} className={`grid gap-5 ${columns}`}>
      {steps.map((step, index) => (
        <li key={step.title} className="gb-card relative p-6 pt-16">
          <span
            className="absolute left-6 top-5 flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {first + index}
          </span>
          <h2 className="text-xl font-semibold text-harbor-deep">{step.title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{step.description}</p>
        </li>
      ))}
    </ol>
  )
}

export function StepJourney({ steps, actionAfterStep, action }: StepJourneyProps) {
  if (!action || !actionAfterStep || actionAfterStep >= steps.length) {
    return <Steps steps={steps} first={1} columns="lg:grid-cols-3" />
  }
  // Two columns, so four steps fill two rows and the action sits under a complete block.
  return (
    <div className="flex flex-col gap-7">
      <Steps steps={steps.slice(0, actionAfterStep)} first={1} columns="md:grid-cols-2" />
      <div className="flex justify-center">{action}</div>
      <Steps steps={steps.slice(actionAfterStep)} first={actionAfterStep + 1} columns="md:grid-cols-2" />
    </div>
  )
}
