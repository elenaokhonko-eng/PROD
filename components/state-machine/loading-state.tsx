'use client'

/**
 * Unified loading / "submitting" / "running" surface used across every State
 * Machine node. One component, two densities (`inline` for small spots and
 * `full` for fullscreen transitions like S-CheckoutRedirect or
 * L2-DecisionRunning).
 */

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StateMachineLoadingProps {
  /** Short label shown next to / below the spinner. */
  title?: string
  /** Optional secondary line for context ("Analysing your case...", etc.). */
  description?: string
  /** `inline` = small spinner next to copy; `full` = centered fullscreen. */
  size?: 'inline' | 'full'
  className?: string
}

export function StateMachineLoading({
  title = 'Loading...',
  description,
  size = 'full',
  className,
}: StateMachineLoadingProps) {
  if (size === 'inline') {
    return (
      <div
        className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{title}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-[200px] w-full flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      <div className="space-y-1">
        <p className="text-base font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  )
}
