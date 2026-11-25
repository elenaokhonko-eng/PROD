'use client'

import { PhoneOff } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Part B walk-through (25 Nov, PB-6): no greyed button under a line that says how to book.

export interface ConsultCtaProps {
  priceLabel?: string
  isStartingCheckout?: boolean
  errorMessage?: string | null
  onClick: () => void
}

export function ConsultCta(_props: ConsultCtaProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-muted p-2 text-muted-foreground">
          <PhoneOff className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <CardTitle>Human consultation</CardTitle>
          <CardDescription>
            Human consultation is separate from automated GuideBuoy outputs: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.
          </CardDescription>
        </div>
      </CardHeader>
    </Card>
  )
}
