// Shape of a synthetic FIDReC update case (lanes plan, Step 0). Every value in these fixtures is invented: the
// institutions are placeholders, amounts and dates are made up, IP addresses come from the documentation ranges
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), ASNs from the documentation range (64496-64511) and emails use
// example.com. CLAUDE.md: no real case data in the repo.

import type { Instrument } from '../../../supabase/functions/_shared/facts/keys.ts'
import type { SectionInput } from '../../../supabase/functions/_shared/facts/update/contract.ts'

/** A section's input without the provider; tests pair it with the fake provider and the synthetic corpus. */
export type CaseSectionData = Omit<SectionInput, 'provider'>

export interface FidrecUpdateCase {
  id: string
  description: string
  data: CaseSectionData
  /** What the case is built to exercise, so lanes can assert against it. */
  shape: {
    instruments: Instrument[]
    hasAccessRecord: boolean
    hasCardAuthenticationRecord: boolean
    /** assessSrf's view of the account portion, or null when there is none. */
    srfPortion: 'likely_in_scope' | 'likely_out_of_scope' | 'unclear' | null
    hasCardPortion: boolean
  }
}
