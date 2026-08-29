'use client'

import { CheckCircle2 } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface ContactRequestConfirmedProps {
  whatsappUrl?: string | null
}

export function ContactRequestConfirmed(_props: ContactRequestConfirmedProps) {
  return (
    <Card className="mx-auto max-w-lg border-harbor-success/40 bg-harbor-success-tint" role="status">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-harbor-success/10 p-2 text-harbor-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <CardTitle>Request received</CardTitle>
          <CardDescription>Your request has been recorded.</CardDescription>
        </div>
      </CardHeader>
    </Card>
  )
}
