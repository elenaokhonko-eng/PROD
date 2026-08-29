import Link from 'next/link'
import { Check } from 'lucide-react'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { Button } from '@/components/ui/button'

const packs = [
  {
    name: 'Free draft',
    price: 'S$0',
    description: 'Answer guided questions and review an organised draft before deciding what to do next.',
    features: ['No payment required', 'Review and correct the organised information'],
  },
  {
    name: 'Full report',
    price: `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`,
    description: 'Review the price and what is included before continuing to checkout.',
    features: ['Generated after confirmed payment', 'Offered only when the server confirms eligibility'],
  },
  {
    name: 'FIDReC case pack',
    price: `S$${PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd}`,
    description: 'Available after a completed report, where offered. Review the scope before checkout.',
    features: ['Separate purchase from the full report', 'Offered only when the server confirms availability'],
  },
] as const

export function PackComparison() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {packs.map((pack, index) => (
        <article key={pack.name} className="gb-card flex flex-col p-6" aria-labelledby={`pack-${index}`}>
          <h2 id={`pack-${index}`} className="text-2xl font-semibold text-harbor-deep">
            {pack.name}
          </h2>
          <p className="mt-3 text-3xl font-semibold">{pack.price}</p>
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
          {pack.name === 'FIDReC case pack' && (
            <p className="mt-3 rounded-control bg-harbor-surface-subtle p-3 text-sm font-medium">
              Human consultation is not currently available.
            </p>
          )}
          <Button asChild variant={index === 0 ? 'default' : 'outline'} className="mt-7 w-full">
            <Link href="/">{index === 0 ? 'Start free — no card required' : 'Start with the free draft'}</Link>
          </Button>
        </article>
      ))}
    </div>
  )
}
