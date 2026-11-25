'use client'

import { UserRoundX } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Part B walk-through (25 Nov, PB-6): no greyed button under a line that says how to book.

export interface SpecialistCardProps {
  name: string
  role?: string
  photoUrl?: string | null
  whatsappNumber?: string | null
  whatsappPrefill?: string
  caseId?: string | null
}

export function SpecialistCard(_props: SpecialistCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-muted p-2 text-muted-foreground">
          <UserRoundX className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <CardTitle>Human consultation</CardTitle>
          <CardDescription>Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.</CardDescription>
        </div>
      </CardHeader>
    </Card>
  )
}
