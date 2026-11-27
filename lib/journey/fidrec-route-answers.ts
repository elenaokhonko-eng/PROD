// The FIDReC route question's answer, as the rows the responses route saves. The route answer is the person's latest
// word on their bank's reply or written complaint, so the matching journey answers follow it; otherwise an older "no
// reply yet" contradicts it on the confirm screen and the confirmed facts can close the route after payment (decision 7).
// A changed answer also clears what the earlier one filled in (Elena, 27 Nov 2026, gate run 45867707804: a written
// complaint dated after the final reply stayed behind).

export function fidrecRouteResponses(
  answers: Record<string, string>,
  previous: { route: string; date: string | null } | null = null,
): Array<{ question_key: string; response_value: string; response_type: 'text' | 'date' }> {
  const route = answers.fidrec_route
  const mirrored: Record<string, string> =
    route === 'final_reply'
      ? { journey_bank_reply_status: 'final_reply', journey_bank_reply_date: answers.fidrec_final_reply_date }
      : route === 'no_reply'
        ? { journey_written_complaint: 'yes', journey_written_complaint_date: answers.fidrec_complaint_date }
        : {}

  const cleared: Record<string, string> = {}
  if (previous?.route === 'final_reply' && route !== 'final_reply') {
    Object.assign(cleared, { journey_bank_reply_status: '', journey_bank_reply_date: '' })
  }
  if (previous?.route === 'no_reply' && route !== 'no_reply') {
    // A complaint made on or before the final reply now chosen contradicts nothing, so it stays.
    const stillTrue = route === 'final_reply' && previous.date !== null && previous.date <= answers.fidrec_final_reply_date
    if (!stillTrue) Object.assign(cleared, { journey_written_complaint: '', journey_written_complaint_date: '' })
  }

  return Object.entries({ ...answers, ...cleared, ...mirrored }).map(([question_key, response_value]) => ({
    question_key,
    response_value,
    response_type: question_key.endsWith('_date') ? 'date' : 'text',
  }))
}
