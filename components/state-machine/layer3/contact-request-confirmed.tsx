'use client'

/**
 * Layer 3 node `L3-ContactRequestConfirmed` (SM Diagram 4 / IS §9.9).
 *
 * Confirmation card after a successful POST to `/api/contact-requests`.
 * The WhatsApp CTA here re-uses the same deep link from
 * `<SpecialistCard>` so users can start the direct conversation right
 * after submitting.
 */

import { CheckCircle2, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface ContactRequestConfirmedProps {
  /** Optional whatsapp URL (same one the specialist card renders). */
  whatsappUrl?: string | null
}

export function ContactRequestConfirmed({ whatsappUrl }: ContactRequestConfirmedProps) {
  return (
    <Card className="mx-auto max-w-lg border-primary/30 bg-[var(--gb-tint-sage)]">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-primary/10 p-2 text-primary">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Request received</CardTitle>
          <CardDescription>
            We have received your request and will be in touch within 1-2 business days. You can also
            message our specialist directly via WhatsApp in the meantime.
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
