// The four synthetic cases of the FIDReC pack update (lanes plan, Step 0) and the synthetic corpus.

import { accountSrfCase } from './account-srf.ts'
import { cardOnlyCase } from './card-only.ts'
import type { FidrecUpdateCase } from './case.ts'
import { mixedCase } from './mixed.ts'
import { noTechnicalRecordsCase } from './no-technical-records.ts'

export type { CaseSectionData, FidrecUpdateCase } from './case.ts'
export { EUPG_A_TO, SRF_FRAUD_SURVEILLANCE_FROM, syntheticCorpus } from './corpus.ts'
export { accountSrfCase, cardOnlyCase, mixedCase, noTechnicalRecordsCase }

export const FIDREC_UPDATE_CASES: readonly FidrecUpdateCase[] = [accountSrfCase, cardOnlyCase, mixedCase, noTechnicalRecordsCase]
