import type {
  ValidationAnswerType,
  ValidationAnswerValue,
  ValidationGapItemRow,
  ValidationQuestion,
} from '@/lib/types/validation'

export interface ValidationChoiceOption {
  value: string
  label: string
}

const SUPPORTED_ANSWER_TYPES = new Set<ValidationAnswerType>([
  'text',
  'date',
  'datetime',
  'money',
  'number',
  'boolean',
  'single_choice',
  'multi_choice',
  'file_upload',
  'textarea',
  'long_text',
])

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanScalar(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return cleanString(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function normalizeValidationAnswerType(value: unknown): ValidationAnswerType {
  const raw = cleanString(value)
  if (!raw) return 'text'
  return SUPPORTED_ANSWER_TYPES.has(raw as ValidationAnswerType)
    ? (raw as ValidationAnswerType)
    : 'text'
}

export function normalizeGapItemToQuestion(row: ValidationGapItemRow): ValidationQuestion | null {
  const key = cleanString(row.field_key)
  const question = cleanString(row.question_text)
  if (!key || !question) return null

  return {
    key,
    question,
    field_type: normalizeValidationAnswerType(row.expected_answer_type),
    required: row.severity === 'required',
    options: Array.isArray(row.answer_options) ? row.answer_options : [],
    severity: row.severity,
    help_text: row.help_text ?? null,
    id: row.id,
    field_label: row.field_label,
    gap_type: row.gap_type,
    sort_order: row.sort_order,
    source: row.source,
  }
}

export function normalizeLegacyValidationQuestion(
  rawQuestion: unknown,
  index: number,
): ValidationQuestion | null {
  const raw = asRecord(rawQuestion)
  if (!raw) return null

  const key =
    cleanString(raw.key) ??
    cleanString(raw.field_key) ??
    cleanString(raw.field) ??
    cleanString(raw.id) ??
    `gap_${index}`
  const question =
    cleanString(raw.question) ??
    cleanString(raw.question_text) ??
    cleanString(raw.suggested_question)

  if (!question) return null

  const options = raw.options ?? raw.answer_options
  const severity = cleanString(raw.severity) ?? undefined

  return {
    ...raw,
    key,
    question,
    field_type: normalizeValidationAnswerType(
      raw.field_type ?? raw.answer_type ?? raw.expected_answer_type,
    ),
    required: raw.required === true || severity === 'required',
    options: Array.isArray(options) ? options : [],
    severity,
    help_text: cleanString(raw.help_text) ?? null,
  }
}

export function getPreferredValidationQuestions(
  gapItems: ValidationGapItemRow[] | null | undefined,
  legacyQuestions: unknown[] | null | undefined,
): ValidationQuestion[] {
  const gapItemQuestions = (gapItems ?? [])
    .map((item) => normalizeGapItemToQuestion(item))
    .filter((item): item is ValidationQuestion => Boolean(item))

  if (gapItemQuestions.length > 0) return gapItemQuestions

  return (legacyQuestions ?? [])
    .map((question, index) => normalizeLegacyValidationQuestion(question, index))
    .filter((item): item is ValidationQuestion => Boolean(item))
}

export function normalizeAnswerOptions(options: unknown[] | null | undefined): ValidationChoiceOption[] {
  return (options ?? [])
    .map((option, index) => {
      if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
        const value = String(option)
        return { value, label: value }
      }

      const raw = asRecord(option)
      if (!raw) return null

      const value =
        cleanScalar(raw.value) ??
        cleanScalar(raw.key) ??
        cleanScalar(raw.id) ??
        cleanString(raw.label) ??
        cleanString(raw.name) ??
        `option_${index}`
      const label =
        cleanString(raw.label) ??
        cleanString(raw.name) ??
        cleanString(raw.title) ??
        value

      return { value, label }
    })
    .filter((option): option is ValidationChoiceOption => Boolean(option))
}

export function isAnsweredValidationValue(value: ValidationAnswerValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'boolean') return true
  return typeof value === 'string' && value.trim().length > 0
}

export function serializeValidationAnswer(value: ValidationAnswerValue): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

export function getValidationResponseTypes(questions: ValidationQuestion[]): Record<string, string> {
  return Object.fromEntries(
    questions.map((question) => [
      question.key,
      normalizeValidationAnswerType(question.field_type),
    ]),
  )
}
