import { PENDING_LABEL, TEAM } from '@/lib/content/team'

// The Marketplace's partners (Elena, 19 Nov 2026). Wording approved by Elena; the partner's team reviews the live page
// and advises corrections. A pending partner is shown greyed out with "Pending finalisation" until confirmed.

export type Partner = {
  id: string
  heading: string
  person: string
  title: string
  line: string
  photo: string
  website: { label: string; href: string }
  status: 'shown' | 'pending'
}

const viviene = TEAM.find((member) => member.name === 'Viviene Sandhu')!

export const PARTNERS: readonly Partner[] = [
  {
    id: 'clifford-law',
    heading: 'First legal partner, pending confirmation',
    person: viviene.name,
    title: 'Advocate & Solicitor, Clifford Law LLP',
    line: 'Viviene Sandhu of Clifford Law LLP has agreed in principle to be GuideBuoy’s first legal partner. Details will follow once the arrangement is confirmed.',
    photo: viviene.photo,
    website: { label: 'Clifford Law LLP website', href: 'https://www.cliffordlaw.sg/' },
    status: 'pending',
  },
]

export { PENDING_LABEL }

// Elena, 19 Nov 2026: the intro names the unconfirmed first partner.
export const MARKETPLACE_INTRO =
  'These cards describe possible categories and a first partner that is not yet confirmed. They are not referrals or available services.'
