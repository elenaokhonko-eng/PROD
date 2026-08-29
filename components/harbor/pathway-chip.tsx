import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  primary: 'border-primary/30 bg-harbor-teal-tint text-foreground',
  formal: 'border-harbor-blue/30 bg-harbor-teal-tint text-foreground',
  waiting: 'border-harbor-warning/30 bg-harbor-warning-tint text-foreground',
} as const

export function PathwayChip({
  children,
  tone = 'primary',
}: {
  children: ReactNode
  tone?: keyof typeof tones
}) {
  return (
    <span className={cn('inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-sm font-medium', tones[tone])}>
      {children}
    </span>
  )
}
