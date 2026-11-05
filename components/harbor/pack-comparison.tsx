import Link from 'next/link'
import { Check } from 'lucide-react'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { Button } from '@/components/ui/button'

// Three separate options (spec section 6), not a sequence: the free evaluation, the bank dispute pack before a
// final reply, and the FIDReC escalation pack after one. In stage 1 the paid packs show "Available from [date]".
const packs = [
  {
    name: 'Free evaluation',
    price: 'S$0',
    description: 'Understand where you stand and your options, free.',
    features: ['No payment required', 'You confirm every fact before anything is written'],
    paid: false,
  },
  {
    name: 'Bank dispute pack',
    price: `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`,
    description:
      'Haven’t sent your bank a full written complaint yet, or not sure yours was complete? Prepare one with your evidence.',
    features: ['For before your bank’s final reply', 'A separate option: start here or skip it'],
    paid: true,
  },
  {
    name: 'FIDReC escalation pack',
    price: `S$${PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd}`,
    description:
      'Received your bank’s final reply and disagree? Prepare a complete, neutral case pack for FIDReC.',
    features: [
      'After your bank’s final reply, or four weeks after your written complaint',
      'A separate option: no bank pack needed first',
    ],
    paid: true,
  },
] as const

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function PackComparison({ headingLevel = 'h2' }: { headingLevel?: 'h2' | 'h3' }) {
  const paidStages = paidStagesState()
  const Heading = headingLevel
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {packs.map((pack, index) => (
        <article key={pack.name} className="gb-card flex flex-col p-6" aria-labelledby={`pack-${index}`}>
          <Heading id={`pack-${index}`} className="text-2xl font-semibold text-harbor-deep">
            {pack.name}
          </Heading>
          <p className="mt-3 text-3xl font-semibold">{pack.price}</p>
          {pack.paid && !paidStages.enabled && (
            <p className="mt-2 text-sm font-semibold text-harbor-blue">Available from {formatDate(paidStages.availableFrom)}</p>
          )}
          <p className="mt-3 min-h-14 leading-6 text-muted-foreground">{pack.description}</p>
          <ul className="mt-6 flex-1 space-y-3">
            {pack.features.map((feature) => (
              <li key={feature} className="flex gap-3 text-sm leading-6">
                <Check className="mt-1 size-4 shrink-0 text-harbor-sage" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
          </p>
          {pack.name === 'FIDReC escalation pack' && (
            <p className="mt-3 rounded-control bg-harbor-surface-subtle p-3 text-sm font-medium">
              Human consultation is not currently available.
            </p>
          )}
          <Button asChild variant={index === 0 ? 'default' : 'outline'} className="mt-7 w-full">
            <Link href="/#tell-your-story">
              {index === 0 ? 'Start free — no card required' : 'Start with the free evaluation'}
            </Link>
          </Button>
        </article>
      ))}
    </div>
  )
}
