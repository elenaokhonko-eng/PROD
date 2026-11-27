// CR-2 (amended 27 Nov 2026): the timeline questionnaire, the first step after buying the FIDReC pack. Its answers are
// saved as the journey answers, so the confirm step and the generator read the same thing, and whether the pack can be
// generated is the generator's own check on that same mapping (rules/fidrec.ts fidrecPackCheck).

import { answerCandidates, type BankReply, formatDate, fidrecPackCheck, type FidrecPackCheck, type ReportedEvent } from '@/lib/facts'

// Wording approved by Elena, 27 Nov 2026, to be used exactly as written (docs/release/cr-2-one-dashboard-flow.md).
export const FIDREC_BEFORE_PAYMENT =
  'FIDReC takes a complaint after you have complained to your bank, and the bank has answered or four weeks have passed. If that is not yet your situation, your pack waits for you until it is.'
export const FIDREC_NOT_COMPLAINED =
  'FIDReC sends back a dispute that was not first raised with the bank (Rule 4(2)). The Bank dispute pack prepares that written complaint from your facts. Send it to your bank, then come back here when your bank replies, or when its reply does not resolve the matter. Your FIDReC pack waits for you.'
export const fidrecWaitingText = (complaintDate: string, endsOn: string) =>
  `FIDReC takes a complaint once your bank has answered and the matter is not resolved, or four weeks after your written complaint (Rule 13(1)(i)). Your written complaint is dated ${formatDate(complaintDate)}, so the four weeks end on ${formatDate(endsOn)}. You can wait for your bank's reply, or write to your bank now and ask for its answer. Your pack is ready to generate as soon as either happens.`

export interface FidrecTimeline {
  complained: boolean
  complaintDate: string | null
  /** Null when there is no written complaint. */
  answered: boolean | null
  replyDate: string | null
  /** Whether the reply says it is final; null when there is no reply. */
  final: boolean | null
}

export const FIDREC_TIMELINE_KEY = 'fidrec_timeline'

type Row = { question_key: string; response_value: string; response_type: 'text' | 'date' }

/**
 * A key that no longer applies is written empty, so a changed answer leaves nothing behind. What the questionnaire does
 * not ask (the reply's outcome, whether a final reply qualifies) is left as it is while that reply stands.
 */
export function fidrecTimelineResponses(t: FidrecTimeline): Row[] {
  const answered = t.complained && t.answered === true
  const values: Record<string, string> = {
    [FIDREC_TIMELINE_KEY]: 'answered',
    journey_written_complaint: t.complained ? 'yes' : 'no',
    journey_written_complaint_date: t.complained ? t.complaintDate ?? '' : '',
    journey_bank_reply_status: !t.complained ? '' : answered ? (t.final ? 'final_reply' : 'interim') : 'none',
    journey_bank_reply_date: answered ? t.replyDate ?? '' : '',
    ...(answered ? {} : { journey_bank_reply_outcome: '' }),
    ...(answered && t.final ? {} : { journey_final_reply_qualifies: '' }),
    // The earlier route question's answer (before 27 Nov) is withdrawn.
    fidrec_route: '',
    fidrec_final_reply_date: '',
    fidrec_complaint_date: '',
    // A written complaint is a report to the bank, and a reply cannot be confirmed without one (snapshot.ts).
    ...(t.complained ? { journey_reported_to_bank: 'yes' } : {}),
  }
  return Object.entries(values).map(([question_key, response_value]) => ({
    question_key,
    response_value,
    response_type: question_key.endsWith('_date') ? 'date' : 'text',
  }))
}

/** The saved questionnaire, or null if it has not been answered. */
export function readFidrecTimeline(rows: ReadonlyArray<{ question_key: string; response_value: unknown }>): FidrecTimeline | null {
  const value = (key: string) => {
    const row = rows.find((r) => r.question_key === key)
    return typeof row?.response_value === 'string' && row.response_value ? row.response_value : null
  }
  if (value(FIDREC_TIMELINE_KEY) !== 'answered') return null
  const complained = value('journey_written_complaint') === 'yes'
  const status = value('journey_bank_reply_status')
  const answered = complained ? status === 'interim' || status === 'final_reply' : null
  return {
    complained,
    complaintDate: complained ? value('journey_written_complaint_date') : null,
    answered,
    replyDate: answered ? value('journey_bank_reply_date') : null,
    final: answered ? status === 'final_reply' : null,
  }
}

export function fidrecTimelineCheck(t: FidrecTimeline, today: string): FidrecPackCheck {
  const { candidates } = answerCandidates(
    fidrecTimelineResponses(t).map((r) => ({ questionKey: r.question_key, value: r.response_value, revisionId: '' })),
  )
  const found = (key: string) => candidates.find((c) => c.factKey === key)?.value ?? null
  return fidrecPackCheck(
    { writtenComplaint: found('written_complaint_sent') as ReportedEvent | null, bankReply: found('bank_reply') as BankReply | null },
    today,
  )
}

export const singaporeToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
