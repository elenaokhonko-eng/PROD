// Elena, 28 Nov 2026: a pack bought without a free evaluation asks the free evaluation's questions. After a FIDReC
// pack's timeline questionnaire, what it already answered (the written complaint and the bank's reply) is not asked
// again.

import type { FidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { JOURNEY_KEYS } from '@/lib/facts'

export interface JourneyQuestionPlan {
  askComplaint: boolean
  askReply: boolean
  /** The timeline says the reply is final: what the letter said is still asked. */
  replyIsFinal: boolean
  initial: Record<string, string>
}

export function journeyQuestionPlan(timeline: FidrecTimeline | null): JourneyQuestionPlan {
  if (!timeline) return { askComplaint: true, askReply: true, replyIsFinal: false, initial: {} }
  return {
    askComplaint: false,
    askReply: false,
    replyIsFinal: timeline.final === true,
    initial: timeline.complained ? { [JOURNEY_KEYS.reportedToBank]: 'yes' } : {},
  }
}
