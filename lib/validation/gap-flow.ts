import type { CaseValidationRunRow, ValidationGapItemRow, ValidationQuestion } from '@/lib/types/validation'

/** Shown when validation/missing_fields indicate gaps but neither gap rows nor legacy questions exist. */
export const GAP_QUESTIONS_FALLBACK_NOTICE =
  "We found missing information, but couldn't generate follow-up questions. Please try again."

export function validationIndicatesMissingData(validation: CaseValidationRunRow | null): boolean {
  if (!validation) return false
  if (validation.status === 'needs_user' || validation.status === 'invalid') return true
  if (Array.isArray(validation.missing_fields) && validation.missing_fields.length > 0) return true
  return false
}

export function legacyQuestionsToUserList(raw: unknown): ValidationQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((q, i) => normalizeLegacyQuestion(q, i))
    .filter((q): q is ValidationQuestion => Boolean(q.key && q.question))
}

function normalizeLegacyQuestion(q: unknown, index: number): ValidationQuestion {
  const o = q as Record<string, unknown>
  const key =
    (typeof o.key === 'string' && o.key.trim()) ||
    (typeof o.field_key === 'string' && o.field_key.trim()) ||
    (typeof o.field === 'string' && o.field.trim()) ||
    (typeof o.id === 'string' && o.id.trim()) ||
    `legacy-question-${index}`
  const question =
    (typeof o.question === 'string' && o.question.trim()) ||
    (typeof o.question_text === 'string' && o.question_text.trim()) ||
    String(o.question ?? o.question_text ?? '')
  return {
    ...o,
    key,
    question,
    required: typeof o.required === 'boolean' ? o.required : undefined,
    field_type:
      typeof o.field_type === 'string'
        ? o.field_type
        : typeof o.answer_type === 'string'
          ? o.answer_type
          : typeof o.expected_answer_type === 'string'
            ? o.expected_answer_type
            : undefined,
  } as ValidationQuestion
}

/**
 * Layer 1 gap loop: structured gap rows, legacy JSON, or “missing but no questions” error state.
 * `gapItems === undefined` means the gap-items query has not settled yet for this validation run.
 */
export function deriveInGapPhase(
  validation: CaseValidationRunRow | null,
  gapItems: ValidationGapItemRow[] | undefined,
): boolean {
  if (!validation) return false
  if (validation.status === 'error') return true

  const legacy = legacyQuestionsToUserList(validation.questions_to_user)
  const hasQuestions = (gapItems?.length ?? 0) > 0 || legacy.length > 0
  if (hasQuestions) return true
  if (gapItems === undefined && validation.status === 'needs_user') return true
  return gapItems !== undefined && !hasQuestions && validationIndicatesMissingData(validation)
}

export function hasOpenValidationQuestions(
  validation: CaseValidationRunRow | null,
  gapItems: ValidationGapItemRow[] | undefined,
): boolean {
  if (!validation) return false
  const legacyCount = legacyQuestionsToUserList(validation.questions_to_user).length
  return (gapItems?.length ?? 0) > 0 || legacyCount > 0
}
