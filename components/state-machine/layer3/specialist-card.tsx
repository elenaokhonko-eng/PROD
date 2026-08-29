'use client'

import { UserRoundX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
          <CardDescription>Human consultation is not currently available.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button type="button" className="min-h-11" disabled>
          Consultation unavailable
        </Button>
      </CardContent>
    </Card>
  )
}
