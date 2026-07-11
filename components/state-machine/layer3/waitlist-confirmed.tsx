'use client'

/**
 * Layer 3 node `L3-WaitlistConfirmed` (SM Diagram 4 / IS §9.9).
 *
 * Confirmation card after a successful POST to `/api/escalation-waitlist`.
 * The WhatsApp CTA here re-uses the same deep link from
 * `<SpecialistCard>` so users can start the direct conversation right
 * after submitting.
 */

import { CheckCircle2, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface WaitlistConfirmedProps {
  /** Optional whatsapp URL (same one the specialist card renders). */
  whatsappUrl?: string | null
}

export function WaitlistConfirmed({ whatsappUrl }: WaitlistConfirmedProps) {
  return (
    <Card className="mx-auto max-w-lg border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>You&apos;re on the list</CardTitle>
          <CardDescription>
            Your specialist will reach out within one business day. You can also message them
            directly via WhatsApp in the meantime.
          </CardDescription>
        </div>
      </CardHeader>
      {whatsappUrl ? (
        <CardContent>
          <Button asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
              Message on WhatsApp
            </a>
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}
