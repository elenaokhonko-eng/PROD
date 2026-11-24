// Synthetic: a card-only case. A digital token is activated on an unrecognised device, the credit card is added to a
// mobile wallet on that device, and three e-commerce payments are authenticated through 3-D Secure with that token
// (the sequence's `linked` line). The complainant asked for a dispute; the institution declined. All values invented.

import type { FidrecUpdateCase } from './case.ts'

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

const transactions = [
  { date: '2025-09-12', amount: sgd(1_980), channel: 'online card payment', payee: 'Example Electronics Store', last4: '0001', instrument: 'sg_card' as const },
  { date: '2025-09-12', amount: sgd(2_450), channel: 'online card payment', payee: 'Example Travel Agency', last4: '0001', instrument: 'sg_card' as const },
  { date: '2025-09-13', amount: sgd(3_120), channel: 'online card payment', payee: 'Example Luxury Goods', last4: '0001', instrument: 'sg_card' as const },
]

const card = {
  cardScheme: 'visa' as const,
  amount: null,
  merchantCountry: 'Exampleland',
  entryMode: 'ecommerce' as const,
  authentication: 'three_ds_digital_token' as const,
  authenticationResult: 'authenticated' as const,
  sentTo: null,
  deviceLabel: 'Phone model EX-300',
  deviceRef: 'dev-ex-0102',
  tokenRef: 'tok-ex-0102',
  walletProvisionedAt: null,
  walletDeviceLabel: null,
  walletProvisioningAuthentication: null,
  walletProvisioningSentTo: null,
  walletTokenRemovedAt: null,
}

export const cardOnlyCase = {
  id: 'card-only',
  description: 'Credit card only: token activated, card added to a wallet, 3-D Secure payments approved with that token',
  data: {
    facts: {
      institution_names: confirmed([{ name: 'Example Bank A', type: 'bank' as const }]),
      account_types: confirmed(['credit_card' as const]),
      scam_type: confirmed(['phishing_sms_or_message' as const]),
      phishing_channel: confirmed('messaging_app' as const),
      credentials_or_otp_shared: confirmed('entered_on_fake_site_or_app' as const),
      impersonated_entity_type: confirmed('government' as const),
      transactions: confirmed(transactions),
      total_loss: confirmed({ ...sgd(7_550), account: 'credit_card' as const }),
      reported_to_bank: confirmed({ value: 'yes' as const, date: '2025-09-13', reference: 'EXAMPLE-REF-0102', channel: 'hotline' }),
      bank_reply: confirmed({ status: 'final_reply' as const, date: '2025-10-20', outcome: 'rejected' as const, qualifies: 'yes' as const, reference: 'EXAMPLE-REF-0102' }),
      access_events: confirmed([
        { timestamp: '2025-09-12T20:10:00+08:00', kind: 'token_activated' as const, deviceLabel: 'Phone model EX-300', deviceRef: 'dev-ex-0102', ip: '198.51.100.40', channel: 'mobile app', authorisedBy: 'SMS one-time code', sentTo: 'registered mobile number', tokenRef: 'tok-ex-0102', relatedTransactionIndex: null },
        { timestamp: '2025-09-12T20:10:40+08:00', kind: 'alert_sent' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'email', authorisedBy: null, sentTo: 'cardholder@example.com', tokenRef: null, relatedTransactionIndex: null },
        { timestamp: '2025-09-12T20:15:00+08:00', kind: 'login' as const, deviceLabel: 'Phone model EX-300', deviceRef: 'dev-ex-0102', ip: '198.51.100.40', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, tokenRef: null, relatedTransactionIndex: null },
        { timestamp: '2025-09-13T08:45:00+08:00', kind: 'account_blocked' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'hotline', authorisedBy: null, sentTo: null, tokenRef: null, relatedTransactionIndex: null },
      ]),
      card_auth_events: confirmed([
        {
          ...card,
          timestamp: '2025-09-12T20:32:00+08:00',
          transactionIndex: null,
          merchant: null,
          entryMode: 'wallet_token' as const,
          authentication: 'wallet_device' as const,
          walletProvisionedAt: '2025-09-12T20:32:00+08:00',
          walletDeviceLabel: 'Phone model EX-300',
          walletProvisioningAuthentication: 'digital_token' as const,
          walletProvisioningSentTo: null,
          walletTokenRemovedAt: '2025-09-13T09:00:00+08:00',
        },
        { ...card, timestamp: '2025-09-12T20:48:00+08:00', transactionIndex: 0, amount: transactions[0].amount, merchant: 'Example Electronics Store' },
        { ...card, timestamp: '2025-09-12T21:02:00+08:00', transactionIndex: 1, amount: transactions[1].amount, merchant: 'Example Travel Agency' },
        { ...card, timestamp: '2025-09-13T00:15:00+08:00', transactionIndex: 2, amount: transactions[2].amount, merchant: 'Example Luxury Goods' },
      ]),
      device_recognition: confirmed([
        { deviceRef: 'dev-ex-0102', deviceLabel: 'Phone model EX-300', firstSeenAt: '2025-09-12T20:10:00+08:00', answer: 'not_mine' as const },
      ]),
      access_record_requested: confirmed({ value: 'yes' as const, date: '2025-09-20', reference: null, channel: 'email' }),
      card_dispute_requested: confirmed({ value: 'yes' as const, date: '2025-09-14', reference: null, channel: 'email' }),
      card_dispute_response: confirmed({
        status: 'declined' as const,
        date: '2025-10-20',
        reasonStated: 'the payments were authenticated with the registered digital token',
        outcome: null,
      }),
      institution_fault_label: confirmed({
        label: 'grossly negligent',
        labelEvidenceId: 'E2',
        conduct: 'entered card details and a one-time code on a website reached from a message',
        conductEvidenceId: 'E2',
      }),
      transaction_alert_threshold: confirmed({ amount: sgd(500), setBy: 'account_holder' as const }),
      token_activation_method: confirmed('sms_code' as const),
    },
    payments: transactions.map((t, index) => ({ ...t, index, excludedFromDrainTest: false })),
    institution: { name: 'Example Bank A', type: 'bank' as const, code: 'example_bank_a' },
    instruments: ['sg_card' as const],
    ipLocations: [
      { ip: '198.51.100.40', country: 'Exampleland', region: 'Example Region', city: 'Example City', accuracyRadiusKm: 20, asn: 64503, organisation: 'Example Broadband', flags: [], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: null },
    ],
    // The day the pack is generated (SectionInput.generatedOn), fixed so the any-date reads are repeatable.
    generatedOn: '2026-11-24',
    evidenceIds: {
      transactions: ['E1'],
      total_loss: ['E1'],
      bank_reply: ['E2'],
      card_dispute_response: ['E2'],
      institution_fault_label: ['E2'],
      access_events: ['E4'],
      card_dispute_requested: ['E5'],
      card_auth_events: ['E6'],
    },
  },
  shape: {
    instruments: ['sg_card'],
    hasAccessRecord: true,
    hasCardAuthenticationRecord: true,
    srfPortion: null,
    hasCardPortion: true,
  },
} satisfies FidrecUpdateCase
