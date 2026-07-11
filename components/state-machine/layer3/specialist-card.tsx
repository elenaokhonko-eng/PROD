'use client'

/**
 * Layer 3 node `L3-contact-specialist` (SM Diagram 4 / IS §9.9).
 *
 * Specialist hero card — photo, name, LinkedIn, WhatsApp CTA. No backend
 * call. The WhatsApp CTA is a `wa.me/<number>` deep link; LinkedIn is a
 * plain external anchor.
 *
 * Pure presentational. All data is injected as props so the component
 * can be mocked in storybook-like galleries and so the operator's name
 * / photo / number lives in configuration, not code.
 */

import Image from 'next/image'
import { ExternalLink, Linkedin, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface SpecialistCardProps {
  name: string
  role?: string
  /** Public photo URL (Next Image-optimised). If omitted, renders a placeholder. */
  photoUrl?: string | null
  /** Full https:// URL to the LinkedIn profile. */
  linkedinUrl?: string | null
  /** Whatsapp number in international format without `+` — e.g. `6591234567`. */
  whatsappNumber?: string | null
  /** Pre-filled WhatsApp message. Defaults to a sensible template. */
  whatsappPrefill?: string
  /** Optional case ID; when provided, is appended to the WhatsApp message so
   *  the specialist can pull up context quickly. */
  caseId?: string | null
}

export function SpecialistCard({
  name,
  role = 'Escalation specialist',
  photoUrl,
  linkedinUrl,
  whatsappNumber,
  whatsappPrefill,
  caseId,
}: SpecialistCardProps) {
  const waHref = whatsappNumber ? buildWhatsAppUrl(whatsappNumber, whatsappPrefill, caseId) : null

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
          {photoUrl ? (
            <Image src={photoUrl} alt={name} fill sizes="80px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground">
              {name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1">
          <CardTitle>{name}</CardTitle>
          <CardDescription>{role}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          FIDReC case preparation is being automated. In the meantime, reach out to our specialist
          to help you on your case in person.
        </p>
        <div className="flex flex-wrap gap-2">
          {waHref ? (
            <Button asChild>
              <a href={waHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                Message on WhatsApp
              </a>
            </Button>
          ) : null}
          {linkedinUrl ? (
            <Button variant="outline" asChild>
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer">
                <Linkedin className="mr-2 h-4 w-4" aria-hidden />
                LinkedIn profile
                <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function buildWhatsAppUrl(
  number: string,
  prefill: string | undefined,
  caseId: string | null | undefined,
): string {
  const cleaned = number.replace(/[^0-9]/g, '')
  const baseMessage =
    prefill ??
    "Hi — I'd like help with my GuideBuoy case. I've already completed the free triage."
  const withCase = caseId ? `${baseMessage} (Case ID: ${caseId})` : baseMessage
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(withCase)}`
}
