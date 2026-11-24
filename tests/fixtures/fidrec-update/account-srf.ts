// Synthetic: a bank-account case in SRF scope. A digital token is activated on an unrecognised device after an SMS
// phishing message; a payee is added inside 12 hours; two further devices log in with that token; three transfers
// take more than 50% of a balance above S$50,000 within 24 hours, after 16 June 2025. All values invented.

import type { FidrecUpdateCase } from './case.ts'

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

const transactions = [
  { date: '2025-07-03', amount: sgd(12_000), channel: 'online transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'account_transfer' as const },
  { date: '2025-07-03', amount: sgd(12_500), channel: 'online transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'account_transfer' as const },
  { date: '2025-07-04', amount: sgd(7_000), channel: 'online transfer', payee: 'Payee account at Example Bank C', last4: null, instrument: 'account_transfer' as const },
]

export const accountSrfCase = {
  id: 'account-srf',
  description: 'Bank account, SRF scope: token on an unrecognised device, payee added, two further logins, fraud-surveillance figures reached',
  data: {
    facts: {
      institution_names: confirmed([{ name: 'Example Bank A', type: 'bank' as const }]),
      account_types: confirmed(['savings_or_current' as const]),
      scam_type: confirmed(['phishing_sms_or_message' as const]),
      phishing_channel: confirmed('sms' as const),
      credentials_or_otp_shared: confirmed('entered_on_fake_site_or_app' as const),
      impersonated_entity_type: confirmed('other_business' as const),
      transactions: confirmed(transactions),
      total_loss: confirmed({ ...sgd(31_500), account: 'savings_or_current' as const }),
      reported_to_bank: confirmed({ value: 'yes' as const, date: '2025-07-04', reference: 'EXAMPLE-REF-0001', channel: 'hotline' }),
      bank_reply: confirmed({ status: 'final_reply' as const, date: '2025-07-28', outcome: 'rejected' as const, qualifies: 'yes' as const, reference: 'EXAMPLE-REF-0001' }),
      reported_to_police: confirmed({ value: 'yes' as const, date: '2025-07-04', reference: null, channel: 'online' }),
      access_events: confirmed([
        { timestamp: '2025-07-03T21:05:00+08:00', kind: 'otp_sent' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'sms', authorisedBy: null, sentTo: 'registered mobile number', relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:06:00+08:00', kind: 'token_activated' as const, deviceLabel: 'Phone model EX-200', deviceRef: 'dev-ex-0002', ip: '203.0.113.24', channel: 'mobile app', authorisedBy: 'SMS one-time code', sentTo: 'registered mobile number', relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:06:30+08:00', kind: 'alert_sent' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'sms', authorisedBy: null, sentTo: 'registered mobile number', relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:10:00+08:00', kind: 'login' as const, deviceLabel: 'Phone model EX-200', deviceRef: 'dev-ex-0002', ip: '203.0.113.24', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:20:00+08:00', kind: 'payee_added' as const, deviceLabel: 'Phone model EX-200', deviceRef: 'dev-ex-0002', ip: '203.0.113.24', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:35:00+08:00', kind: 'login' as const, deviceLabel: 'Browser on desktop EX-PC', deviceRef: 'dev-ex-0003', ip: '198.51.100.7', channel: 'internet banking', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: null },
        { timestamp: '2025-07-03T21:40:00+08:00', kind: 'payment_authenticated' as const, deviceLabel: 'Browser on desktop EX-PC', deviceRef: 'dev-ex-0003', ip: '198.51.100.7', channel: 'internet banking', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: 0 },
        { timestamp: '2025-07-03T21:40:30+08:00', kind: 'alert_sent' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'email', authorisedBy: null, sentTo: 'holder@example.com', relatedTransactionIndex: 0 },
        { timestamp: '2025-07-03T22:05:00+08:00', kind: 'payment_authenticated' as const, deviceLabel: 'Phone model EX-200', deviceRef: 'dev-ex-0002', ip: '203.0.113.24', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: 1 },
        { timestamp: '2025-07-03T22:05:30+08:00', kind: 'alert_sent' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'email', authorisedBy: null, sentTo: 'holder@example.com', relatedTransactionIndex: 1 },
        { timestamp: '2025-07-04T07:05:00+08:00', kind: 'login' as const, deviceLabel: 'Tablet model EX-T1', deviceRef: 'dev-ex-0004', ip: '192.0.2.150', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: null },
        { timestamp: '2025-07-04T07:10:00+08:00', kind: 'payment_authenticated' as const, deviceLabel: 'Tablet model EX-T1', deviceRef: 'dev-ex-0004', ip: '192.0.2.150', channel: 'mobile app', authorisedBy: 'digital token', sentTo: null, relatedTransactionIndex: 2 },
        { timestamp: '2025-07-04T09:30:00+08:00', kind: 'account_blocked' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'hotline', authorisedBy: null, sentTo: null, relatedTransactionIndex: null },
      ]),
      device_recognition: confirmed([
        { deviceRef: 'dev-ex-0002', deviceLabel: 'Phone model EX-200', firstSeenAt: '2025-07-03T21:06:00+08:00', answer: 'not_mine' as const },
        { deviceRef: 'dev-ex-0003', deviceLabel: 'Browser on desktop EX-PC', firstSeenAt: '2025-07-03T21:35:00+08:00', answer: 'not_mine' as const },
        { deviceRef: 'dev-ex-0004', deviceLabel: 'Tablet model EX-T1', firstSeenAt: '2025-07-04T07:05:00+08:00', answer: 'not_sure' as const },
      ]),
      access_record_requested: confirmed({ value: 'yes' as const, date: '2025-07-10', reference: null, channel: 'email' }),
      institution_fault_label: confirmed({
        label: 'negligent',
        labelEvidenceId: 'E2',
        conduct: 'entered the account password and a one-time code on a website reached from a message',
        conductEvidenceId: 'E2',
      }),
      balance_before_first_disputed_payment: confirmed(sgd(56_000)),
      transaction_alert_threshold: confirmed({ amount: sgd(100), setBy: 'default' as const }),
      token_activation_method: confirmed('sms_code' as const),
    },
    payments: transactions.map((t, index) => ({ ...t, index, excludedFromDrainTest: false })),
    institution: { name: 'Example Bank A', type: 'bank' as const, code: 'example_bank_a' },
    instruments: ['account_transfer' as const],
    ipLocations: [
      { ip: '203.0.113.24', country: 'Exampleland', region: null, city: 'Example City', accuracyRadiusKm: 50, asn: 64500, organisation: 'Example Hosting Network', flags: ['hosting' as const], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: null },
      { ip: '198.51.100.7', country: 'Exampleland', region: null, city: 'Example Town', accuracyRadiusKm: 100, asn: 64501, organisation: 'Example Mobile Network', flags: [], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: null },
      { ip: '192.0.2.150', country: null, region: null, city: null, accuracyRadiusKm: null, asn: 64502, organisation: 'Example VPN Service', flags: ['vpn' as const], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: 'Exampleland' },
    ],
    evidenceIds: {
      transactions: ['E1'],
      total_loss: ['E1'],
      balance_before_first_disputed_payment: ['E1'],
      bank_reply: ['E2'],
      institution_fault_label: ['E2'],
      reported_to_police: ['E3'],
      access_events: ['E4'],
      access_record_requested: ['E5'],
    },
  },
  shape: {
    instruments: ['account_transfer'],
    hasAccessRecord: true,
    hasCardAuthenticationRecord: false,
    srfPortion: 'likely_in_scope',
    hasCardPortion: false,
  },
} satisfies FidrecUpdateCase
