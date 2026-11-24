// Synthetic: an e-wallet case (a payment service provider) with no technical record uploaded. No access or card
// authentication facts, no IP locations; every comparison that needs a record is `not_shown`, and the bank pack asks
// for the record. All values invented.

import type { FidrecUpdateCase } from './case.ts'

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

const transactions = [
  { date: '2025-08-02', amount: sgd(2_300), channel: 'e-wallet transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'ewallet' as const },
  { date: '2025-08-02', amount: sgd(1_700), channel: 'e-wallet transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'ewallet' as const },
]

export const noTechnicalRecordsCase = {
  id: 'no-technical-records',
  description: 'E-wallet payments with no access record and no card authentication record uploaded',
  data: {
    facts: {
      institution_names: confirmed([{ name: 'Example Pay', type: 'payment_service_provider' as const }]),
      account_types: confirmed(['ewallet' as const]),
      scam_type: confirmed(['fake_website_or_ad' as const]),
      phishing_channel: confirmed('social_media' as const),
      credentials_or_otp_shared: confirmed('entered_on_fake_site_or_app' as const),
      impersonated_entity_type: confirmed('other_business' as const),
      transactions: confirmed(transactions),
      total_loss: confirmed({ ...sgd(4_000), account: 'ewallet' as const }),
      reported_to_bank: confirmed({ value: 'yes' as const, date: '2025-08-03', reference: null, channel: 'in-app chat' }),
      bank_reply: confirmed({ status: 'none' as const, date: null, outcome: null, qualifies: null, reference: null }),
      access_record_requested: confirmed({ value: 'no' as const, date: null, reference: null, channel: null }),
      balance_before_first_disputed_payment: { value: null, label: 'not_known' as const },
      transaction_alert_threshold: { value: null, label: 'not_known' as const },
      token_activation_method: { value: null, label: 'not_known' as const },
    },
    payments: transactions.map((t, index) => ({ ...t, index, excludedFromDrainTest: false })),
    institution: { name: 'Example Pay', type: 'payment_service_provider' as const, code: null },
    instruments: ['ewallet' as const],
    ipLocations: [],
    evidenceIds: {
      transactions: ['E1'],
      total_loss: ['E1'],
    },
  },
  shape: {
    instruments: ['ewallet'],
    hasAccessRecord: false,
    hasCardAuthenticationRecord: false,
    srfPortion: 'likely_in_scope',
    hasCardPortion: false,
  },
} satisfies FidrecUpdateCase
