// The FIDReC route question's answer, as the rows the responses route saves. The route answer is the person's latest
// word on their bank's reply or written complaint, so the matching journey answers follow it; otherwise an older "no
// reply yet" contradicts it on the confirm screen and the confirmed facts can close the route after payment (decision 7).

export function fidrecRouteResponses(
  answers: Record<string, string>,
): Array<{ question_key: string; response_value: string; response_type: 'text' | 'date' }> {
  const mirrored: Record<string, string> =
    answers.fidrec_route === 'final_reply'
      ? { journey_bank_reply_status: 'final_reply', journey_bank_reply_date: answers.fidrec_final_reply_date }
      : answers.fidrec_route === 'no_reply'
        ? { journey_written_complaint: 'yes', journey_written_complaint_date: answers.fidrec_complaint_date }
        : {}
  return Object.entries({ ...answers, ...mirrored }).map(([question_key, response_value]) => ({
    question_key,
    response_value,
    response_type: question_key.endsWith('_date') ? 'date' : 'text',
  }))
}
