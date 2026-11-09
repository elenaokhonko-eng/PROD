import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  addMonths,
  daysBetween,
  institutionsIn,
  normaliseDate,
  normaliseInstitution,
  normaliseMoney,
  normaliseYesNo,
  requiredFactsFor,
  sameInstitutionSet,
  validateFactValue,
} from '../../lib/facts'

test('dates normalise to ISO with Singapore day/month order', () => {
  assert.equal(normaliseDate('2026-10-03'), '2026-10-03')
  assert.equal(normaliseDate('2026-10-03T09:15:00+08:00'), '2026-10-03')
  assert.equal(normaliseDate('03/10/2026'), '2026-10-03')
  assert.equal(normaliseDate('3.10.26'), '2026-10-03')
  assert.equal(normaliseDate('3rd October 2026'), '2026-10-03')
  assert.equal(normaliseDate('Oct 3, 2026'), '2026-10-03')
  for (const bad of ['31/02/2026', 'yesterday', '2026-13-01', '', null, 12]) {
    assert.equal(normaliseDate(bad), null, String(bad))
  }
})

test('money keeps its currency and converts only SGD', () => {
  assert.deepEqual(normaliseMoney('S$2,400'), { amount: 2400, currency: 'SGD', amountSgd: 2400 })
  assert.deepEqual(normaliseMoney('SGD 2400.50'), { amount: 2400.5, currency: 'SGD', amountSgd: 2400.5 })
  assert.deepEqual(normaliseMoney('2400'), { amount: 2400, currency: 'SGD', amountSgd: 2400 })
  assert.deepEqual(normaliseMoney('USD 100'), { amount: 100, currency: 'USD', amountSgd: null })
  assert.deepEqual(normaliseMoney('100 MYR'), { amount: 100, currency: 'MYR', amountSgd: null })
  for (const bad of ['about two thousand', '2.400,00', '-5', '', null]) {
    assert.equal(normaliseMoney(bad), null, String(bad))
  }
})

test('yes/no answers normalise and unknown text stays unknown', () => {
  assert.equal(normaliseYesNo('Yes'), 'yes')
  assert.equal(normaliseYesNo('No'), 'no')
  assert.equal(normaliseYesNo('Not sure'), 'unsure')
  assert.equal(normaliseYesNo(true), 'yes')
  assert.equal(normaliseYesNo('I think so'), null)
})

test('institution aliases give a canonical name and type', () => {
  assert.deepEqual(normaliseInstitution('POSB'), { name: 'DBS/POSB', type: 'bank' })
  assert.deepEqual(normaliseInstitution('DBS PayLah!'), { name: 'DBS PayLah!', type: 'payment_service_provider' })
  assert.deepEqual(normaliseInstitution('Singtel'), { name: 'Singtel', type: 'telco' })
  assert.deepEqual(normaliseInstitution('Singtel Dash'), { name: 'Singtel Dash', type: 'payment_service_provider' })
  assert.deepEqual(normaliseInstitution('Synthetic Bank'), { name: 'Synthetic Bank', type: 'other' })
  assert.deepEqual(
    institutionsIn('DBS and GrabPay / Singtel').map((i) => i.name).sort(),
    ['DBS/POSB', 'GrabPay', 'Singtel'],
  )
  assert.equal(sameInstitutionSet(institutionsIn('POSB'), institutionsIn('DBS')), true)
  assert.equal(sameInstitutionSet(institutionsIn('OCBC'), institutionsIn('DBS')), false)
  assert.equal(normaliseInstitution('otherwise fine')?.type, 'other')
})

test('deadline arithmetic: 28 days and calendar months with month-end clamping', () => {
  assert.equal(addDays('2026-11-05', 28), '2026-12-03')
  assert.equal(addMonths('2026-10-28', 6), '2027-04-28')
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28')
  assert.equal(addMonths('2027-08-31', 6), '2028-02-29')
  assert.equal(daysBetween('2026-11-05', '2026-12-03'), 28)
})

test('stage requirements grow from free to bank to FIDReC', () => {
  const free = requiredFactsFor('free', ['digital_phishing'])
  const bank = requiredFactsFor('bank', ['digital_phishing'])
  const fidrec = requiredFactsFor('fidrec', ['digital_phishing'])
  assert.ok(free.every((k) => bank.includes(k)))
  assert.ok(bank.every((k) => fidrec.includes(k)))
  assert.ok(fidrec.includes('written_complaint_sent'))
  assert.ok(!requiredFactsFor('free', ['investment']).includes('phishing_channel'))
})

test('a typed date after today or before 2000 is refused (walkthrough, 9 Nov)', () => {
  assert.equal(validateFactValue('date_discovered', '2099-01-01'), null)
  assert.equal(validateFactValue('date_discovered', '1990-01-01'), null)
  assert.equal(validateFactValue('date_discovered', '2026-10-03'), '2026-10-03')
  assert.equal(validateFactValue('reported_to_police', { value: 'yes', date: '2099-01-01' }), null)
  assert.equal(validateFactValue('transactions', [{ date: '2099-01-01', amount: 10 }]), null)
})
