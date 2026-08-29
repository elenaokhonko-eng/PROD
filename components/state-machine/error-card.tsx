'use client'

/**
 * State Machine error surface. Renders the five error shapes defined in
 * docs/State-Machine-Workflow.md §8.1. One component, five variants, so error
 * styling is consistent across every layer.
 *
 * Used by every route-level container via `<ErrorBoundary>` (Slice 5.5) and
 * directly by hooks that expose `isError`.
 */

import { AlertCircle, Lock, Search, ServerCrash, WifiOff, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type StateMachineErrorKind =
  | 'unauthorised'
  | 'rls_violation'
  | 'not_found'
  | 'internal'
  | 'realtime_disconnected'

interface ErrorShape {
  title: string
  description: string
  icon: LucideIcon
  retryLabel: string
}

const SHAPES: Record<StateMachineErrorKind, ErrorShape> = {
  unauthorised: {
    title: 'Please sign in',
    description: 'Your session has expired. Sign in again to continue.',
    icon: Lock,
    retryLabel: 'Sign in',
  },
  rls_violation: {
    title: "You don't have access",
    description:
      "You don't have access to this case. If you believe this is a mistake, contact support.",
    icon: Lock,
    retryLabel: 'Go back',
  },
  not_found: {
    title: 'Case not found',
    description: "We couldn't find this case, or the signed-in account does not have access.",
    icon: Search,
    retryLabel: 'Back to home',
  },
  internal: {
    title: 'Something went wrong',
    description: 'The page could not be loaded. Retry, or return to the previous page.',
    icon: ServerCrash,
    retryLabel: 'Retry',
  },
  realtime_disconnected: {
    title: 'Live updates paused',
    description: 'Refresh to reconnect and request the current case status.',
    icon: WifiOff,
    retryLabel: 'Reconnect',
  },
}

export interface StateMachineErrorCardProps {
  kind: StateMachineErrorKind
  /** Retained for call-site compatibility. Error details are logged, not rendered. */
  context?: string | Error | null
  /** Called when the user clicks the retry button. If omitted, button is hidden. */
  onRetry?: () => void
  className?: string
}

export function StateMachineErrorCard({ kind, onRetry, className }: StateMachineErrorCardProps) {
  const shape = SHAPES[kind]
  const Icon = shape.icon

  return (
    <Card className={cn('border-destructive/30 bg-destructive/5', className)} role="alert">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-destructive/10 p-2 text-destructive">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base">{shape.title}</CardTitle>
          <CardDescription>{shape.description}</CardDescription>
        </div>
      </CardHeader>
      {onRetry ? (
        <CardContent>
          <Button onClick={onRetry} variant="outline" className="min-h-11 gap-2">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {shape.retryLabel}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}

/** Map common HTTP statuses / error objects to a StateMachineErrorKind.
 *  Used by hooks + route containers that don't know the kind up front. */
export function inferErrorKind(err: unknown): StateMachineErrorKind {
  if (!err) return 'internal'
  const anyErr = err as { status?: number; code?: string; message?: string }
  if (anyErr.status === 401) return 'unauthorised'
  if (anyErr.status === 403 || anyErr.code === '42501') return 'rls_violation'
  if (anyErr.status === 404) return 'not_found'
  if (anyErr.message?.toLowerCase().includes('realtime')) return 'realtime_disconnected'
  return 'internal'
}
