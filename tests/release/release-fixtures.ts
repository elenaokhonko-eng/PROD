export type PurchaseFixture = {
  caseId: string
  purchaseId: string
}

export type HarborReleaseFixtures = {
  schemaVersion: 1
  users: {
    userA: { supabaseUuid: string; ownedCaseId: string; disposable: true }
    userB: { supabaseUuid: string; ownedCaseId: string; disposable: true }
    deletionUser: { supabaseUuid: string; ownedCaseId: string; disposable: true }
  }
  ownership: {
    protectedCaseId: string
    protectedQuestionKey: string
    originalResponseValue: string
  }
  onboarding: { anonymousNarrative: string }
  evidence: {
    uploadCaseId: string
    gapCaseId: string
    missingQuestionsCaseId: string
    readyCaseId: string
    mixedOutcomeCaseId: string
  }
  collaboration: {
    expiredCaseId: string
    expiredEvidenceId: string
    expiredInvitationToken: string
  }
  reports: {
    runningCaseId: string
    draftingCaseId: string
    readyCaseId: string
    failedCaseId: string
  }
  payments: {
    freeCaseId: string
    selfServeCheckoutCaseId: string
    tier2CheckoutCaseId: string
    cancelResumeCaseId: string
    concurrentCheckoutCaseId: string
    delayedEntitlement: { caseId: string; sessionId: string }
    blockedSecondCheckout: {
      paid: PurchaseFixture
      partiallyRefunded: PurchaseFixture
      refunded: PurchaseFixture
      disputed: PurchaseFixture
    }
  }
  contact: { caseId: string; email: string; expectedOwnerSupabaseUuid: string }
  privacy: { settingsCaseId: string }
  serviceRole: { protectedPaths: string[] }
}

export const requiredReleaseFixturePaths = [
  'users.userA.supabaseUuid',
  'users.userA.ownedCaseId',
  'users.userB.supabaseUuid',
  'users.userB.ownedCaseId',
  'users.deletionUser.supabaseUuid',
  'users.deletionUser.ownedCaseId',
  'ownership.protectedCaseId',
  'ownership.protectedQuestionKey',
  'ownership.originalResponseValue',
  'onboarding.anonymousNarrative',
  'evidence.uploadCaseId',
  'evidence.gapCaseId',
  'evidence.missingQuestionsCaseId',
  'evidence.readyCaseId',
  'evidence.mixedOutcomeCaseId',
  'collaboration.expiredCaseId',
  'collaboration.expiredEvidenceId',
  'collaboration.expiredInvitationToken',
  'reports.runningCaseId',
  'reports.draftingCaseId',
  'reports.readyCaseId',
  'reports.failedCaseId',
  'payments.freeCaseId',
  'payments.selfServeCheckoutCaseId',
  'payments.tier2CheckoutCaseId',
  'payments.cancelResumeCaseId',
  'payments.concurrentCheckoutCaseId',
  'payments.delayedEntitlement.caseId',
  'payments.delayedEntitlement.sessionId',
  'payments.blockedSecondCheckout.paid.caseId',
  'payments.blockedSecondCheckout.paid.purchaseId',
  'payments.blockedSecondCheckout.partiallyRefunded.caseId',
  'payments.blockedSecondCheckout.partiallyRefunded.purchaseId',
  'payments.blockedSecondCheckout.refunded.caseId',
  'payments.blockedSecondCheckout.refunded.purchaseId',
  'payments.blockedSecondCheckout.disputed.caseId',
  'payments.blockedSecondCheckout.disputed.purchaseId',
  'contact.caseId',
  'contact.email',
  'contact.expectedOwnerSupabaseUuid',
  'privacy.settingsCaseId',
] as const

export function readReleaseFixtures(): HarborReleaseFixtures {
  const raw = process.env.HARBOR_RELEASE_FIXTURES_JSON?.trim()
  if (!raw) throw new Error('HARBOR_RELEASE_FIXTURES_JSON is required.')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('HARBOR_RELEASE_FIXTURES_JSON must contain valid JSON.')
  }
  return assertReleaseFixtures(parsed)
}

export function assertReleaseFixtures(
  value: unknown,
  options: { allowPlaceholders?: boolean } = {},
): HarborReleaseFixtures {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Harbor release fixtures must use schemaVersion 1.')
  }

  const invalid = requiredReleaseFixturePaths.filter((path) => {
    const item = readPath(value, path)
    if (typeof item !== 'string' || !item.trim()) return true
    if (!options.allowPlaceholders && isPlaceholder(item)) return true
    if (isUuidFixturePath(path) && !isPlaceholder(item) && !uuidPattern.test(item)) return true
    if (path === 'payments.delayedEntitlement.sessionId' && !isPlaceholder(item) && !item.startsWith('cs_test_')) return true
    return false
  }) as string[]
  const protectedPaths = readPath(value, 'serviceRole.protectedPaths')
  if (
    !Array.isArray(protectedPaths) ||
    protectedPaths.length === 0 ||
    protectedPaths.some((path) =>
      typeof path !== 'string' ||
      !path.startsWith('/api/') ||
      (!options.allowPlaceholders && isPlaceholder(path)),
    )
  ) {
    invalid.push('serviceRole.protectedPaths')
  }
  for (const path of [
    'users.userA.disposable',
    'users.userB.disposable',
    'users.deletionUser.disposable',
  ]) {
    if (readPath(value, path) !== true) invalid.push(path)
  }
  if (!options.allowPlaceholders) {
    if (hasDuplicateValues(value, [
      'users.userA.supabaseUuid',
      'users.userB.supabaseUuid',
      'users.deletionUser.supabaseUuid',
    ])) invalid.push('users.*.supabaseUuid must be distinct')
    if (hasDuplicateValues(value, [
      'users.userA.ownedCaseId',
      'users.userB.ownedCaseId',
      'users.deletionUser.ownedCaseId',
    ])) invalid.push('users.*.ownedCaseId must be distinct')
    if (hasDuplicateValues(value, requiredReleaseFixturePaths.filter((path) => /caseId$/i.test(path)))) {
      invalid.push('all fixture case IDs must be distinct disposable synthetic cases')
    }
  }
  if (invalid.length) {
    throw new Error(`Harbor release fixtures are missing or invalid: ${Array.from(new Set(invalid)).join(', ')}`)
  }

  return value as HarborReleaseFixtures
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidFixturePath(path: string) {
  return /(?:Uuid|CaseId|PurchaseId|EvidenceId)$/.test(path)
}

function isPlaceholder(value: string) {
  return /^<[^>]+>$/.test(value.trim())
}

function hasDuplicateValues(value: Record<string, unknown>, paths: string[]) {
  const items = paths.map((path) => readPath(value, path))
  return items.every((item): item is string => typeof item === 'string') && new Set(items).size !== items.length
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    return isRecord(current) ? current[segment] : undefined
  }, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
