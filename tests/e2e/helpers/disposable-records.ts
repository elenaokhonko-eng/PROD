import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type DisposableCleanupScope = {
  caseId: string
  evidenceIds?: string[]
  storagePaths?: string[]
  caseDocumentIds?: string[]
  jobIds?: string[]
  reportIds?: string[]
  decisionRunIds?: string[]
  caseResponseIds?: string[]
  validationGapItemIds?: string[]
  validationRunIds?: string[]
  extractRunIds?: string[]
  paymentIds?: string[]
  casePurchaseIds?: string[]
  webhookEventIds?: string[]
  entitlementCaseIds?: string[]
  privacyDeletionRequestIds?: string[]
}

export type DisposableValidationCase = DisposableCleanupScope & {
  ownerId: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const storagePathPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([a-z0-9][a-z0-9_-]{0,62})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[a-z0-9]+$/i
const uuidScopedFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[-_.][^/\\]+$/i

export function createServiceClientFromEnvironment(
  supabaseUrlName = 'NEXT_PUBLIC_SUPABASE_URL',
  serviceRoleKeyName = 'SUPABASE_SERVICE_ROLE_KEY',
) {
  return createClient(requiredEnvironment(supabaseUrlName), requiredEnvironment(serviceRoleKeyName), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createDisposableCase(
  supabase: SupabaseClient,
  options: {
    ownerId: string
    summary: string
    status?: string
    narrative?: string
  },
): Promise<DisposableValidationCase> {
  const caseId = randomUUID()
  requireUuid(options.ownerId, 'disposable owner profile id')
  const { error } = await supabase.from('cases').insert({
    id: caseId,
    user_id: options.ownerId,
    owner_user_id: options.ownerId,
    creator_user_id: options.ownerId,
    claim_type: 'phishing_scam',
    status: options.status ?? 'draft',
    case_status: 'DRAFT',
    case_summary: options.summary,
    primary_narrative: options.narrative ?? options.summary,
    claim_currency: 'SGD',
    jurisdiction: 'SG',
    is_anonymous: false,
  })
  if (error) throw new Error(`Unable to create disposable case: ${error.message}`)
  return { caseId, ownerId: options.ownerId }
}

export async function createDisposableGapCase(
  supabase: SupabaseClient,
  options: {
    ownerId: string
    summary: string
    questionKey?: string
    includeQuestion?: boolean
  },
): Promise<DisposableValidationCase> {
  const fixture = await createDisposableCase(supabase, {
    ownerId: options.ownerId,
    summary: options.summary,
    narrative: `${options.summary} Evidence and follow-up question disposable fixture.`,
  })
  const extractRunId = randomUUID()
  const validationRunId = randomUUID()
  const fieldKey = options.questionKey ?? `release_gate_${randomUUID().replaceAll('-', '_')}`
  const includeQuestion = options.includeQuestion ?? true

  const { error: extractError } = await supabase.from('case_extract_runs').insert({
    id: extractRunId,
    case_id: fixture.caseId,
    extract_json: {
      source: 'harbor_release_disposable_fixture',
      case_id: fixture.caseId,
    },
    missing_fields: ['transaction_date'],
    model_name: 'release-gate-fixture',
    prompt_version: 'fixture-v1',
  })
  if (extractError) {
    await cleanupDisposableRecords(supabase, fixture)
    throw new Error(`Unable to create disposable extract run: ${extractError.message}`)
  }
  fixture.extractRunIds = [extractRunId]

  const question = {
    question_key: fieldKey,
    field_key: fieldKey,
    question_text: 'What date did the disputed transaction happen?',
    response_type: 'text',
    expected_answer_type: 'text',
  }
  const { error: validationError } = await supabase.from('case_validation_runs').insert({
    id: validationRunId,
    case_id: fixture.caseId,
    extract_run_id: extractRunId,
    missing_fields: ['transaction_date'],
    ambiguities: [],
    questions_to_user: includeQuestion ? [question] : [],
    validation_summary: includeQuestion
      ? 'Disposable fixture needs one follow-up answer.'
      : 'Disposable fixture has missing data but no generated follow-up questions.',
    status: 'needs_user',
    source: 'rules',
    model_name: 'release-gate-fixture',
    prompt_version: 'fixture-v1',
    schema_version: 'v1',
    is_valid: false,
    raw_output: { source: 'harbor_release_disposable_fixture' },
  })
  if (validationError) {
    await cleanupDisposableRecords(supabase, fixture)
    throw new Error(`Unable to create disposable validation run: ${validationError.message}`)
  }
  fixture.validationRunIds = [validationRunId]

  if (includeQuestion) {
    const gapItemId = randomUUID()
    const { error: gapError } = await supabase.from('case_validation_gap_items').insert({
      id: gapItemId,
      validation_run_id: validationRunId,
      case_id: fixture.caseId,
      extract_run_id: extractRunId,
      field_key: fieldKey,
      field_label: 'Transaction date',
      gap_type: 'missing_required_field',
      severity: 'required',
      question_text: 'What date did the disputed transaction happen?',
      help_text: 'Use an approximate date if the exact date is unavailable.',
      expected_answer_type: 'text',
      answer_options: [],
      source: 'harbor_release_disposable_fixture',
      sort_order: 0,
      raw_gap: { source: 'harbor_release_disposable_fixture' },
      raw_question: question,
    })
    if (gapError) {
      await cleanupDisposableRecords(supabase, fixture)
      throw new Error(`Unable to create disposable gap item: ${gapError.message}`)
    }
    fixture.validationGapItemIds = [gapItemId]
  }

  return fixture
}

export async function cleanupDisposableRecords(supabase: SupabaseClient, scope: DisposableCleanupScope) {
  const caseId = requireUuid(scope.caseId, 'disposable case id')
  const entitlementCaseIds = uniqueUuids(scope.entitlementCaseIds ?? [])
  if (entitlementCaseIds.some((id) => id !== caseId)) {
    throw new Error('Refusing entitlement cleanup outside the disposable case id.')
  }

  await removeEvidenceStorageObjects(supabase, caseId, scope.storagePaths ?? [])
  await deleteRowsById(supabase, 'payment_webhook_events', scope.webhookEventIds)
  await deleteRowsById(supabase, 'privacy_deletion_requests', scope.privacyDeletionRequestIds)
  await deleteRowsById(supabase, 'jobs', scope.jobIds)
  await deleteRowsById(supabase, 'payments', scope.paymentIds)
  await deleteRowsById(supabase, 'case_purchases', scope.casePurchaseIds)
  if (entitlementCaseIds.length) {
    const { error } = await supabase.from('case_entitlements').delete().in('case_id', entitlementCaseIds)
    if (error) throw new Error(`Unable to clean case_entitlements: ${error.message}`)
  }
  await deleteRowsById(supabase, 'case_responses', scope.caseResponseIds)
  await deleteRowsById(supabase, 'evidence', scope.evidenceIds)
  await deleteRowsById(supabase, 'case_documents', scope.caseDocumentIds)
  await deleteRowsById(supabase, 'reports', scope.reportIds)
  await deleteRowsById(supabase, 'case_decision_runs', scope.decisionRunIds)
  await deleteRowsById(supabase, 'case_validation_gap_items', scope.validationGapItemIds)
  await deleteRowsById(supabase, 'case_validation_runs', scope.validationRunIds)
  await deleteRowsById(supabase, 'case_extract_runs', scope.extractRunIds)

  const { error } = await supabase.from('cases').delete().eq('id', caseId)
  if (error) throw new Error(`Unable to clean disposable case: ${error.message}`)

  const { count, error: verifyError } = await supabase
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .eq('id', caseId)
  if (verifyError) throw new Error(`Unable to verify disposable case cleanup: ${verifyError.message}`)
  if (count !== 0) throw new Error('Disposable case cleanup could not be verified.')
}

export function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID.`)
  return value
}

export function requireUuidScopedFilename(value: string, label: string) {
  if (!uuidScopedFilenamePattern.test(value)) {
    throw new Error(`${label} must start with a UUID and contain no path separators.`)
  }
  return value
}

export function requireUuidScopedEvidencePath(value: string, caseId: string) {
  const match = value.match(storagePathPattern)
  if (!match || match[1] !== caseId) {
    throw new Error('Evidence Storage cleanup requires an exact UUID-scoped object path for the disposable case.')
  }
  return value
}

async function removeEvidenceStorageObjects(supabase: SupabaseClient, caseId: string, paths: string[] | undefined) {
  const exactPaths = Array.from(new Set((paths ?? []).map((path) => requireUuidScopedEvidencePath(path, caseId))))
  if (!exactPaths.length) return
  const { error } = await supabase.storage.from('evidence').remove(exactPaths)
  if (error) throw new Error(`Unable to clean evidence Storage objects: ${error.message}`)
}

async function deleteRowsById(supabase: SupabaseClient, table: string, ids: string[] | undefined) {
  const exactIds = uniqueUuids(ids ?? [])
  if (!exactIds.length) return
  const { error } = await supabase.from(table).delete().in('id', exactIds)
  if (error) throw new Error(`Unable to clean ${table}: ${error.message}`)
}

function uniqueUuids(values: string[]) {
  return Array.from(new Set(values.map((value) => requireUuid(value, 'cleanup id'))))
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for disposable release-gate records.`)
  return value
}
