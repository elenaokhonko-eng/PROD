// "Is this one of your devices?" (brief v5, 3b): the screen's state, kept apart from the component so it can be
// tested without a browser. The answers are stored as the device_recognition finding's resolution; the server checks
// them against the finding's own device list (answerDevices), so nothing here is trusted.

import {
  deviceKey,
  deviceName,
  formatDateTime,
  type RecordedDevice,
} from '@/lib/facts'
import type { DeviceRecognition, DeviceRecognitionAnswer } from '../../../../../../../supabase/functions/_shared/facts/update/contract'

// Draft wording for Elena (FIDReC update, Lane 2). Every string the screen shows is here.
export const DEVICE_SCREEN_TEXT = {
  title: 'Is this one of your devices?',
  intro:
    'Your bank’s records show these devices on your account. For each one, tell us whether it’s yours. Your report will give each answer as what you state.',
  firstSeen: 'First seen in the records:',
  reference: 'Reference in the records:',
  save: 'Save my answers',
  saving: 'Saving…',
  answerEach: 'Please answer for each device.',
  saved: 'Your answers are saved.',
  change: 'Change my answers',
  outdated: 'The records changed while you were answering. Please check the list again.',
  failed: 'We couldn’t save your answers. Please try again.',
} as const

export const DEVICE_ANSWER_OPTIONS: ReadonlyArray<{ value: DeviceRecognitionAnswer; label: string }> = [
  { value: 'mine', label: 'Yes, it’s mine' },
  { value: 'not_mine', label: 'No, it’s not mine' },
  { value: 'not_sure', label: 'I’m not sure' },
]

export interface DeviceRow {
  key: string
  name: string
  firstSeen: string | null
  reference: string | null
}

export function deviceRows(devices: readonly RecordedDevice[]): DeviceRow[] {
  return devices.map((d) => ({
    key: deviceKey(d),
    name: deviceName(d),
    firstSeen: formatDateTime(d.firstSeenAt),
    reference: d.deviceRef,
  }))
}

/** Answers already given, by device key; a device added since then has none. */
export function initialAnswers(
  devices: readonly RecordedDevice[],
  saved: readonly DeviceRecognition[] | null,
): Record<string, DeviceRecognitionAnswer> {
  const byKey = new Map((saved ?? []).map((a) => [deviceKey(a), a.answer]))
  const out: Record<string, DeviceRecognitionAnswer> = {}
  for (const d of devices) {
    const answer = byKey.get(deviceKey(d))
    if (answer) out[deviceKey(d)] = answer
  }
  return out
}

export function allAnswered(devices: readonly RecordedDevice[], answers: Record<string, DeviceRecognitionAnswer>): boolean {
  return devices.length > 0 && devices.every((d) => Boolean(answers[deviceKey(d)]))
}

/** The resolution sent for the finding: one entry per device, identified as the records identify it. */
export function devicePayload(
  devices: readonly RecordedDevice[],
  answers: Record<string, DeviceRecognitionAnswer>,
): Array<{ deviceRef: string | null; deviceLabel: string | null; answer: DeviceRecognitionAnswer }> {
  return devices.map((d) => ({ deviceRef: d.deviceRef, deviceLabel: d.deviceLabel, answer: answers[deviceKey(d)] }))
}
