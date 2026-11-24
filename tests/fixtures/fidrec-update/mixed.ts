// Synthetic: a mixed case. Two account transfers and three debit card payments from the same institution, before
// 16 June 2025 (no fraud-surveillance duty yet) and below the S$50,000 balance. The card is added to a wallet with an
// SMS one-time code; one e-commerce payment is 3-D Secure by SMS code with no device recorded (the sequence's
// `not_shown` link), one has no authentication recorded, one is a wallet-token payment. All values invented.

import type { FidrecUpdateCase } from './case.ts'

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

const transactions = [
  { date: '2025-05-20', amount: sgd(4_000), channel: 'online transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'account_transfer' as const },
  { date: '2025-05-20', amount: sgd(5_000), channel: 'online transfer', payee: 'Payee account at Example Bank B', last4: null, instrument: 'account_transfer' as const },
  { date: '2025-05-20', amount: sgd(860), channel: 'online card payment', payee: 'Example Online Marketplace', last4: '0002', instrument: 'sg_card' as const },
  { date: '2025-05-21', amount: sgd(415.5), channel: 'online card payment', payee: 'Example Game Credits', last4: '0002', instrument: 'sg_card' as const },
  { date: '2025-05-21', amount: sgd(1_240), channel: 'contactless wallet payment', payee: 'Example Department Store', last4: '0002', instrument: 'sg_card' as const },
]

const card = {
  cardScheme: 'mastercard' as const,
  amount: null,
  merchantCountry: 'Exampleland',
  sentTo: null,
  deviceLabel: null,
  deviceRef: null,
  tokenRef: null,
  walletProvisionedAt: null,
  walletDeviceLabel: null,
  walletProvisioningAuthentication: null,
  walletProvisioningSentTo: null,
  walletTokenRemovedAt: null,
}

export const mixedCase = {
  id: 'mixed',
  description: 'Account transfers and debit card payments: wallet added by SMS code, 3-D Secure without a device, one payment without authentication',
  data: {
    facts: {
      institution_names: confirmed([{ name: 'Example Bank A', type: 'bank' as const }]),
      account_types: confirmed(['savings_or_current' as const, 'debit_card' as const]),
      scam_type: confirmed(['phishing_email' as const]),
      phishing_channel: confirmed('email' as const),
      credentials_or_otp_shared: confirmed('entered_on_fake_site_or_app' as const),
      impersonated_entity_type: confirmed('bank_or_fi' as const),
      transactions: confirmed(transactions),
      total_loss: confirmed({
        ...sgd(11_515.5),
        portions: [
          { account: 'savings_or_current' as const, amount: sgd(9_000) },
          { account: 'debit_card' as const, amount: sgd(2_515.5) },
        ],
      }),
      reported_to_bank: confirmed({ value: 'yes' as const, date: '2025-05-22', reference: 'EXAMPLE-REF-0203', channel: 'branch' }),
      bank_reply: confirmed({ status: 'interim' as const, date: '2025-06-05', outcome: null, qualifies: 'no' as const, reference: 'EXAMPLE-REF-0203' }),
      access_events: confirmed([
        { timestamp: '2025-05-20T10:02:00+08:00', kind: 'login' as const, deviceLabel: 'Browser on laptop EX-LT', deviceRef: 'dev-ex-0201', ip: '192.0.2.33', channel: 'internet banking', authorisedBy: 'password and SMS one-time code', sentTo: 'registered mobile number', tokenRef: null, relatedTransactionIndex: null },
        { timestamp: '2025-05-20T10:05:00+08:00', kind: 'limit_changed' as const, deviceLabel: 'Browser on laptop EX-LT', deviceRef: 'dev-ex-0201', ip: '192.0.2.33', channel: 'internet banking', authorisedBy: 'SMS one-time code', sentTo: 'registered mobile number', tokenRef: null, relatedTransactionIndex: null },
        { timestamp: '2025-05-20T10:12:00+08:00', kind: 'payment_authenticated' as const, deviceLabel: 'Browser on laptop EX-LT', deviceRef: 'dev-ex-0201', ip: '192.0.2.33', channel: 'internet banking', authorisedBy: 'SMS one-time code', sentTo: 'registered mobile number', tokenRef: null, relatedTransactionIndex: 0 },
        { timestamp: '2025-05-20T10:20:00+08:00', kind: 'payment_authenticated' as const, deviceLabel: 'Browser on laptop EX-LT', deviceRef: 'dev-ex-0201', ip: '192.0.2.33', channel: 'internet banking', authorisedBy: 'SMS one-time code', sentTo: 'registered mobile number', tokenRef: null, relatedTransactionIndex: 1 },
        { timestamp: '2025-05-22T09:15:00+08:00', kind: 'account_blocked' as const, deviceLabel: null, deviceRef: null, ip: null, channel: 'branch', authorisedBy: null, sentTo: null, tokenRef: null, relatedTransactionIndex: null },
      ]),
      card_auth_events: confirmed([
        {
          ...card,
          timestamp: '2025-05-20T11:00:00+08:00',
          transactionIndex: null,
          merchant: null,
          entryMode: 'wallet_token' as const,
          authentication: 'not_known' as const,
          authenticationResult: 'not_known' as const,
          walletProvisionedAt: '2025-05-20T11:00:00+08:00',
          walletDeviceLabel: 'Phone model EX-400',
          walletProvisioningAuthentication: 'sms_otp' as const,
          walletProvisioningSentTo: 'registered mobile number',
        },
        { ...card, timestamp: '2025-05-20T11:30:00+08:00', transactionIndex: 2, amount: transactions[2].amount, merchant: 'Example Online Marketplace', entryMode: 'ecommerce' as const, authentication: 'three_ds_otp' as const, authenticationResult: 'authenticated' as const, sentTo: 'registered mobile number' },
        { ...card, timestamp: '2025-05-21T01:10:00+08:00', transactionIndex: 3, amount: transactions[3].amount, merchant: 'Example Game Credits', entryMode: 'ecommerce' as const, authentication: 'none_recorded' as const, authenticationResult: 'not_known' as const },
        { ...card, timestamp: '2025-05-21T13:45:00+08:00', transactionIndex: 4, amount: transactions[4].amount, merchant: 'Example Department Store', entryMode: 'wallet_token' as const, authentication: 'wallet_device' as const, authenticationResult: 'authenticated' as const, deviceLabel: 'Phone model EX-400' },
      ]),
      device_recognition: confirmed([
        { deviceRef: 'dev-ex-0201', deviceLabel: 'Browser on laptop EX-LT', firstSeenAt: '2025-05-20T10:02:00+08:00', answer: 'not_mine' as const },
      ]),
      access_record_requested: confirmed({ value: 'no' as const, date: null, reference: null, channel: null }),
      card_dispute_requested: confirmed({ value: 'yes' as const, date: '2025-05-22', reference: null, channel: 'branch' }),
      card_dispute_response: confirmed({ status: 'no_answer' as const, date: null, reasonStated: null, outcome: null }),
      balance_before_first_disputed_payment: confirmed(sgd(20_000)),
      transaction_alert_threshold: { value: null, label: 'not_known' as const },
      token_activation_method: confirmed('not_known' as const),
    },
    payments: transactions.map((t, index) => ({ ...t, index, excludedFromDrainTest: t.instrument === 'sg_card' })),
    institution: { name: 'Example Bank A', type: 'bank' as const, code: 'example_bank_a' },
    instruments: ['account_transfer' as const, 'sg_card' as const],
    ipLocations: [
      { ip: '192.0.2.33', country: 'Exampleland', region: null, city: 'Example Port', accuracyRadiusKm: 200, asn: 64504, organisation: 'Example Cloud Hosting', flags: ['hosting' as const, 'proxy' as const], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: null },
    ],
    evidenceIds: {
      transactions: ['E1'],
      total_loss: ['E1'],
      balance_before_first_disputed_payment: ['E1'],
      bank_reply: ['E2'],
      access_events: ['E4'],
      card_dispute_requested: ['E5'],
      card_auth_events: ['E6'],
    },
  },
  shape: {
    instruments: ['account_transfer', 'sg_card'],
    hasAccessRecord: true,
    hasCardAuthenticationRecord: true,
    srfPortion: 'likely_in_scope',
    hasCardPortion: true,
  },
} satisfies FidrecUpdateCase
