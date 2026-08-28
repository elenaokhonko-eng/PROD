"use client"

import { Check, HeartHandshake } from "lucide-react"
import { useRef } from "react"
import { useSensoryMode, type SensoryMode } from "./sensory-mode-provider"

const choices: Array<{ mode: SensoryMode; label: string; shortLabel: string }> = [
  { mode: "steady", label: "I'm okay", shortLabel: "Steady" },
  { mode: "quiet", label: "Everything feels too much", shortLabel: "Quiet" },
  { mode: "grounding", label: "I need a moment", shortLabel: "A moment" },
]

export function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useSensoryMode()
  const detailsRef = useRef<HTMLDetailsElement>(null)

  return (
    <div data-mode-switcher className="relative">
      <details ref={detailsRef} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-ambient marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <HeartHandshake aria-hidden="true" className="h-4 w-4 text-primary" />
          <span className={compact ? "sr-only" : "hidden lg:inline"}>How are you feeling?</span>
          <span>{choices.find((choice) => choice.mode === mode)?.shortLabel}</span>
        </summary>
        <div className="fixed inset-x-4 z-50 mt-2 rounded-[14px] border border-border bg-popover p-2 text-popover-foreground shadow-ambient sm:absolute sm:inset-x-auto sm:right-0 sm:w-72">
          <p className="px-3 pb-2 pt-1 text-sm font-semibold">How are you feeling?</p>
          <div
            aria-label="Choose display intensity"
            aria-orientation="vertical"
            className="space-y-1"
            role="radiogroup"
            onKeyDown={(event) => {
              const focusedMode = (event.target as HTMLElement).dataset.sensoryMode
              const focusedIndex = choices.findIndex((choice) => choice.mode === focusedMode)
              if (focusedIndex < 0) return

              let nextIndex: number | undefined
              if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                nextIndex = (focusedIndex + 1) % choices.length
              } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                nextIndex = (focusedIndex - 1 + choices.length) % choices.length
              } else if (event.key === "Home") {
                nextIndex = 0
              } else if (event.key === "End") {
                nextIndex = choices.length - 1
              }

              if (nextIndex === undefined) return
              event.preventDefault()
              const nextMode = choices[nextIndex].mode
              detailsRef.current
                ?.querySelector<HTMLElement>(`[data-sensory-mode="${nextMode}"]`)
                ?.focus()
              setMode(nextMode)
            }}
          >
            {choices.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                role="radio"
                aria-checked={mode === choice.mode}
                tabIndex={mode === choice.mode ? 0 : -1}
                data-sensory-mode={choice.mode}
                onClick={() => {
                  setMode(choice.mode)
                  const details = detailsRef.current
                  details?.removeAttribute("open")
                  details?.querySelector("summary")?.focus()
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
