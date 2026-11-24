import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { answerDevices, devicesInRecords } from '../../lib/facts'
import type { AccessEvent, CardAuthEvent } from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  allAnswered,
  DEVICE_ANSWER_OPTIONS,
  DEVICE_SCREEN_TEXT,
  devicePayload,
  deviceRows,
  initialAnswers,
} from '../../app/(case)/app/case/[id]/facts/_components/device-answers'
import { accountSrfCase, cardOnlyCase } from '../fixtures/fidrec-update/index.ts'

// FIDReC update, Lane 2 (brief v5, 3b): "Is this one of your devices?". The screen's state is tested here; the
// browser run belongs with the e2e suite (requested from Lane 6). Synthetic cases only.

const facts = accountSrfCase.data.facts
const devices = devicesInRecords(facts.access_events!.value as AccessEvent[], [])
const dir = 'app/(case)/app/case/[id]/facts/_components'

test('each device is listed with its name, the time it was first seen and its reference in the records', () => {
  assert.deepEqual(deviceRows(devices), [
    { key: 'ref:dev-ex-0002', name: 'Phone model EX-200', firstSeen: '3 Jul 2025, 21:06', reference: 'dev-ex-0002' },
    { key: 'ref:dev-ex-0003', name: 'Browser on desktop EX-PC', firstSeen: '3 Jul 2025, 21:35', reference: 'dev-ex-0003' },
    { key: 'ref:dev-ex-0004', name: 'Tablet model EX-T1', firstSeen: '4 Jul 2025, 07:05', reference: 'dev-ex-0004' },
  ])
  const wallet = devicesInRecords([], [{ ...(cardOnlyCase.data.facts.card_auth_events!.value as CardAuthEvent[])[0], deviceRef: null, deviceLabel: null }])
  assert.deepEqual(deviceRows(wallet), [{ key: 'label:phone model ex-300', name: 'Phone model EX-300', firstSeen: '12 Sep 2025, 20:32', reference: null }])
  assert.equal(deviceRows([{ deviceRef: 'dev-ex-0500', deviceLabel: null, firstSeenAt: null }])[0].name, 'A device the records do not name')
})

test('the three answers the brief allows, and nothing else', () => {
  assert.deepEqual(DEVICE_ANSWER_OPTIONS.map((o) => o.value), ['mine', 'not_mine', 'not_sure'])
  assert.equal(DEVICE_SCREEN_TEXT.title, 'Is this one of your devices?')
})

test('saved answers fill the form; a device added since then starts unanswered and blocks saving', () => {
  const saved = facts.device_recognition!.value!.slice(0, 2)
  const answers = initialAnswers(devices, saved)
  assert.deepEqual({ ...answers }, { 'ref:dev-ex-0002': 'not_mine', 'ref:dev-ex-0003': 'not_mine' })
  assert.equal(allAnswered(devices, answers), false)
  assert.equal(allAnswered(devices, { ...answers, 'ref:dev-ex-0004': 'not_sure' }), true)
  assert.equal(allAnswered([], {}), false)
})

test('what the screen sends is what the server accepts, and the server keeps the records’ own details', () => {
  const answers = { 'ref:dev-ex-0002': 'not_mine', 'ref:dev-ex-0003': 'not_mine', 'ref:dev-ex-0004': 'not_sure' } as const
  const payload = devicePayload(devices, answers)
  assert.deepEqual(answerDevices(devices, payload), facts.device_recognition!.value)
})

test('the facts page asks about devices for the paid stages only, before the confirm panel', () => {
  const client = readFileSync(`${dir}/facts-client.tsx`, 'utf8')
  assert.match(client, /stage !== 'free' && <DeviceConfirmation caseId=\{caseId\} stage=\{stage\} \/>\}\s*<ConfirmFactsPanel/)
  const screen = readFileSync(`${dir}/device-confirmation.tsx`, 'utf8')
  assert.match(screen, /kind: 'value', value: devicePayload\(step\.devices, answers\)/)
  // Every string the screen shows comes from the draft list (device-answers.ts), so Elena can review them in one place.
  assert.doesNotMatch(screen, />\s*[A-Z][a-z]+ [a-z]+[^<{]*</, 'no wording written inline in the component')
  assert.doesNotMatch(screen, /console\.|analytics|track\(/)
})
