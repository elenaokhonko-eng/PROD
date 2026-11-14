import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { START_EVALUATION, STORY_ANCHOR } from '@/lib/harbor/cta'
import { cn } from '@/lib/utils'

// The primary call to action on public pages (brief W1 §A3; Addendum V §V1: 16 px semibold with a trailing arrow).
export function StartEvaluationButton({ size = 'lg', className }: { size?: 'sm' | 'lg'; className?: string }) {
  return (
    <Button asChild size={size} className={cn(size === 'lg' && 'text-base font-semibold', className)}>
      <Link href={STORY_ANCHOR}>
        {START_EVALUATION}
        {size === 'lg' ? <ArrowRight aria-hidden="true" /> : null}
      </Link>
    </Button>
  )
}
