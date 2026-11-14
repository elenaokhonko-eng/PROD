import Link from 'next/link'
import { Check } from 'lucide-react'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { Button } from '@/components/ui/button'
import { START_EVALUATION, STORY_ANCHOR } from '@/lib/harbor/cta'

// Three separate options (spec section 6), not a sequence: the free evaluation, the bank dispute pack before a
// final reply, and the FIDReC escalation pack after one. In stage 1 the paid packs show "Coming shortly" (D1: no
// dates). Each card says what it does (C6); the page around the cards carries the "What GuideBuoy is" block (W1 §B3).
const packs = [
  {
    name: 'Free evaluation',
    price: 'S$0',
    description: 'Organise your facts and get an assessment of where you stand and your options, free.',
    features: ['No payment required', 'You confirm every fact before anything is written'],
    paid: false,
  },
  {
    name: 'Bank dispute pack',
    price: `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`,
    description:
      'Haven’t sent your bank a full written complaint yet, or not sure yours was complete? We’ll prepare one with you, with the evidence the bank expects and the regulatory framework in mind.',
    features: ['A concise, formal complaint with the key facts and your evidence', 'For before your bank’s final reply; a separate option'],
    paid: true,
  },
  {
    name: 'FIDReC escalation pack',
    price: `S$${PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd}`,
    description:
      'FIDReC is Singapore’s independent dispute resolution centre for consumers and financial institutions; it costs nothing to start. Go within 6 months of your bank’s final reply, or 4 weeks after a written complaint the bank hasn’t resolved.',
    features: [
      'A comprehensive case pack with every material fact and the arguments on both sides, ready for FIDReC’s process',
      'A separate option: no bank pack needed first',
    ],
    paid: true,
  },
] as const

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
            <p className="mt-2 text-sm font-semibold text-harbor-blue">Coming shortly</p>
          )}
          <p className="mt-3 min-h-14 leading-7 text-foreground">{pack.description}</p>
          <ul className="mt-6 flex-1 space-y-3">
            {pack.features.map((feature) => (
              <li key={feature} className="flex gap-3 text-base leading-7">
                <Check className="mt-1.5 size-4 shrink-0 text-harbor-sage" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button asChild variant={index === 0 ? 'default' : 'outline'} className="mt-7 w-full text-base font-semibold">
            <Link href={STORY_ANCHOR}>{START_EVALUATION}</Link>
          </Button>
        </article>
      ))}
    </div>
  )
}
