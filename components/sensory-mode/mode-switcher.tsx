"use client"

import { Check, HeartHandshake } from "lucide-react"
import { useSensoryMode, type SensoryMode } from "./sensory-mode-provider"

const choices: Array<{ mode: SensoryMode; label: string; shortLabel: string }> = [
  { mode: "steady", label: "I'm okay", shortLabel: "Steady" },
  { mode: "quiet", label: "Everything feels too much", shortLabel: "Quiet" },
  { mode: "grounding", label: "I need a moment", shortLabel: "A moment" },
]

export function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useSensoryMode()

  return (
    <div className="relative">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-ambient marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <HeartHandshake aria-hidden="true" className="h-4 w-4 text-primary" />
          <span className={compact ? "sr-only" : "hidden lg:inline"}>How are you feeling?</span>
          <span>{choices.find((choice) => choice.mode === mode)?.shortLabel}</span>
        </summary>
        <div className="fixed inset-x-4 z-50 mt-2 rounded-[14px] border border-border bg-popover p-2 text-popover-foreground shadow-ambient sm:absolute sm:inset-x-auto sm:right-0 sm:w-72">
          <p className="px-3 pb-2 pt-1 text-sm font-semibold">How are you feeling?</p>
          <div role="radiogroup" aria-label="Choose display intensity" className="space-y-1">
            {choices.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                role="radio"
                aria-checked={mode === choice.mode}
                onClick={(event) => {
                  setMode(choice.mode)
                  event.currentTarget.closest("details")?.removeAttribute("open")
                }}
                className="flex min-h-11 w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{choice.label}</span>
                {mode === choice.mode ? <Check aria-hidden="true" className="h-4 w-4 text-primary" /> : null}
              </button>
            ))}
          </div>
        </div>
      </details>
      <span className="sr-only" aria-live="polite">Display changed to {mode} mode</span>
    </div>
  )
}
