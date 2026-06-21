const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeNullableUuid(value: unknown): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null
  if (!UUID_PATTERN.test(trimmed)) return null

  return trimmed
}

type LoggerLike = {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

type SanitizeNullableSourceIdInput = {
  caseId: string
  field: string
  rawValue: unknown
  validIds: Set<string>
  preview: string
  previewField: "questionTextPreview" | "requestTextPreview" | "explanationPreview"
  logOnMissing?: boolean
  log: LoggerLike
}

export function sanitizeNullableSourceId(input: SanitizeNullableSourceIdInput): string | null {
  const { caseId, field, rawValue, validIds, preview, previewField, logOnMissing = false, log } = input

  if (rawValue == null) {
    if (logOnMissing) {
      log.warn("Dropped invalid source id before insert", {
        caseId,
        field,
        rawValue: null,
        [previewField]: preview,
      })
    }
    return null
  }

  if (typeof rawValue !== "string") {
    log.warn(logOnMissing ? "Dropped invalid source id before insert" : "Nulled invalid source id format before insert", {
      caseId,
      field,
      rawValue: String(rawValue),
      [previewField]: preview,
    })
    return null
  }

  const trimmed = rawValue.trim()
  if (!trimmed) {
    if (logOnMissing) {
      log.warn("Dropped invalid source id before insert", {
        caseId,
        field,
        rawValue: trimmed,
        [previewField]: preview,
      })
    }
    return null
  }

  const normalized = normalizeNullableUuid(trimmed)
  if (!normalized) {
    log.warn(logOnMissing ? "Dropped invalid source id before insert" : "Nulled invalid source id format before insert", {
      caseId,
      field,
      rawValue: trimmed,
      [previewField]: preview,
    })
    return null
  }

  if (!validIds.has(normalized)) {
    log.warn(
      logOnMissing
        ? "Dropped invalid source id before insert"
        : "Nulled source id not found in loaded rows before insert",
      {
        caseId,
        field,
        invalidId: normalized,
        [previewField]: preview,
      },
    )
    return null
  }

  return normalized
}
