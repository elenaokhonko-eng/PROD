import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { assertReleaseFixtures, type HarborReleaseFixtures } from '../tests/release/release-fixtures'
import { parseStateCaseFixtures, type StateCases } from '../tests/e2e/helpers/state-case-fixtures'

// Rebuilds the synthetic staging cases behind HARBOR_STATE_CASES_JSON and HARBOR_RELEASE_FIXTURES_JSON.
//
// - Staging only: the database URL must name project yqqkkftfddxuxmpxwbcj and use sslmode=verify-full with
//   HARBOR_PREVIEW_DB_CA.
// - Synthetic only, for the three CI identities in CLERK_RECONCILIATION_USER_ALLOWLIST_JSON. userGolden and any case
//   the seed did not create are never read or written.
// - Idempotent: case IDs are derived from fixture names, and every run deletes and recreates those cases (tests
//   mutate some of them), all in one transaction.
//
// Usage: pnpm exec tsx scripts/seed-harbor-staging-fixtures.ts [--apply] [--out-dir test-results/seed]
// Without --apply the transaction is rolled back after the checks and inserts (a dry run).

const stagingRef = 'yqqkkftfddxuxmpxwbcj'
const seedNamespace = 'harbor-release-seed-v1'
const seedSource = 'harbor_release_seed'
const intakeKeys = [
  'institution_name',
  'account_details',
  'incident_summary',
  'financial_impact',
  'desired_outcome',
  'previous_contact',
] as const

type Identities = { userA: string; userB: string; deletionUser: string }

// RFC 4122 version 5 (SHA-1, name-based) so the same fixture name always gives the same UUID.
export function seedUuid(name: string) {
  const bytes = createHash('sha1').update(`${seedNamespace}:${name}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const stateCaseNames = {
  layer1Journey: 'state-layer1-journey',
  layer1Intake: 'state-layer1-intake',
  layer1Gap: 'state-layer1-gap',
  layer1Evidence: 'state-layer1-evidence',
  layer1DraftPending: 'state-layer1-draft-pending',
  layer1FreeDraft: 'state-layer1-free-draft',
  transitionBuyReport: 'state-transition-buy-report',
  layer2ConfirmBankFacts: 'state-layer2-confirm-bank-facts',
  layer2Ready: 'state-layer2-ready',
  layer3Unavailable: 'state-layer3-unavailable',
  layer3Tier2: 'state-layer3-tier2',
  layer3FidrecReady: 'state-layer3-fidrec-ready',
} as const satisfies Record<keyof StateCases, string>

// Stage 2 retired these states (a paid bank case is on the confirm step until its pack exists); their synthetic cases
// are removed on the next seed.
const retiredStateCaseNames = ['state-layer2-running', 'state-layer2-drafting', 'state-layer2-failed'] as const

const releaseCaseNames = {
  ownedA: 'owned-user-a',
  ownedB: 'owned-user-b',
  ownedDeletion: 'owned-deletion-user',
  ownershipProtected: 'ownership-protected',
  evidenceUpload: 'evidence-upload',
  evidenceGap: 'evidence-gap',
  evidenceMissingQuestions: 'evidence-missing-questions',
  evidenceReady: 'evidence-ready',
  evidenceMixed: 'evidence-mixed',
  collaborationExpired: 'collaboration-expired',
  reportsRunning: 'reports-running',
  reportsDrafting: 'reports-drafting',
  reportsReady: 'reports-ready',
  reportsFailed: 'reports-failed',
  paymentsFree: 'payments-free',
  paymentsSelfServe: 'payments-self-serve-checkout',
  paymentsTier2: 'payments-tier2-checkout',
  paymentsCancelResume: 'payments-cancel-resume',
  paymentsConcurrent: 'payments-concurrent-checkout',
  paymentsDelayed: 'payments-delayed-entitlement',
  blockedPaid: 'payments-blocked-paid',
  blockedPartiallyRefunded: 'payments-blocked-partially-refunded',
  blockedRefunded: 'payments-blocked-refunded',
  blockedDisputed: 'payments-blocked-disputed',
  contact: 'contact-layer3',
  privacy: 'privacy-settings',
} as const

// Every table a seeded case can have rows in, children first.
const caseChildTables = [
  'jobs',
  'payments',
  'case_purchases',
  'reports',
  'case_entitlements',
  'case_collaborators',
  'invitations',
  'evidence',
  'case_narratives',
  'case_validation_gap_items',
  'case_decision_runs',
  'case_validation_runs',
  'case_extract_runs',
  'case_documents',
  'case_responses',
] as const

class Seeder {
  constructor(private readonly client: pg.Client, private readonly ids: Identities) {}

  async resetCase(caseId: string) {
    const existing = await this.client.query<{ user_id: string }>('select user_id from cases where id = $1', [caseId])
    if (existing.rows.length === 0) return
    if (!Object.values(this.ids).includes(existing.rows[0].user_id)) {
      throw new Error(`Seed case ${caseId} exists but is not owned by a CI identity; refusing to touch it.`)
    }
    for (const table of caseChildTables) {
      await this.client.query(`delete from public.${table} where case_id = $1`, [caseId])
    }
    await this.client.query('delete from cases where id = $1', [caseId])
  }

  // Every case answers the journey questions (stage 1 asks them first) and has a story, unless a fixture tests that
  // step itself.
  async createCase(name: string, ownerId: string, options: { journey?: boolean; story?: boolean } = {}) {
    const caseId = seedUuid(name)
    await this.resetCase(caseId)
    await this.client.query(
      `insert into cases (id, user_id, owner_user_id, creator_user_id, claim_type, status, case_status, case_summary,
         primary_narrative, claim_currency, jurisdiction, is_anonymous)
       values ($1, $2, $2, $2, 'phishing_scam', 'draft', 'DRAFT', $3, $4, 'SGD', 'SG', false)`,
      [caseId, ownerId, `Synthetic release fixture: ${name}.`, options.story === false ? null : `Synthetic release fixture: ${name}.`],
    )
    if (options.journey !== false) {
      await this.client.query(
        `insert into case_responses (case_id, question_key, response_value, response_type) values ($1, 'journey_reported_to_bank', 'yes', 'text')`,
        [caseId],
      )
    }
    return caseId
  }

  // CR-2: the timeline questionnaire after buying, answered: a written complaint 40 days ago with no answer.
  async fidrecTimelineAnswered(caseId: string) {
    await this.client.query(
      `insert into case_responses (case_id, question_key, response_value, response_type) values
         ($1, 'fidrec_timeline', 'answered', 'text'),
         ($1, 'journey_written_complaint', 'yes', 'text'),
         ($1, 'journey_written_complaint_date', to_char((now() at time zone 'Asia/Singapore')::date - 40, 'YYYY-MM-DD'), 'date'),
         ($1, 'journey_bank_reply_status', 'none', 'text')`,
      [caseId],
    )
  }

  // The FIDReC route answer (stage2-plan §3a): a written complaint 40 days ago with no reply, so the pack is for sale.
  async fidrecRouteOpen(caseId: string) {
    await this.client.query(
      `insert into case_responses (case_id, question_key, response_value, response_type) values
         ($1, 'fidrec_route', 'no_reply', 'text'),
         ($1, 'fidrec_complaint_date', to_char((now() at time zone 'Asia/Singapore')::date - 40, 'YYYY-MM-DD'), 'date')`,
      [caseId],
    )
  }

  async intakeResponses(caseId: string) {
    for (const key of intakeKeys) {
      await this.client.query(
        `insert into case_responses (case_id, question_key, response_value, response_type) values ($1, $2, $3, 'text')`,
        [caseId, key, `Synthetic ${key.replaceAll('_', ' ')} for a release fixture.`],
      )
    }
  }

  async document(caseId: string, name: string, options: { processed: boolean; status: string; uploadedMinutesAgo: number }) {
    const id = seedUuid(`${caseId}:document:${name}`)
    await this.client.query(
      `insert into case_documents (id, case_id, filename, original_filename, file_size, mime_type, document_type,
         upload_date, is_processed, processing_status, processed_at, storage_provider, storage_bucket, storage_path)
       values ($1, $2, $3, $3, 1024, 'application/pdf', 'bank_statement', now() - make_interval(mins => $4), $5, $6,
         case when $5 then now() - make_interval(mins => $4) end, 'supabase', 'case_evidence', $7)`,
      [id, caseId, `synthetic-${name}.pdf`, options.uploadedMinutesAgo, options.processed, options.status, `${caseId}/${id}.pdf`],
    )
    return id
  }

  // Extract and valid validation rows: what a free case has before its free draft. No decision, which in the
  // real flow is created by the post-payment job.
  async freeLineage(caseId: string) {
    const extractId = seedUuid(`${caseId}:extract`)
    const validationId = seedUuid(`${caseId}:validation`)
    await this.client.query(
      `insert into case_extract_runs (id, case_id, extract_json, missing_fields, model_name, prompt_version, created_at)
       values ($1, $2, $3, '[]', 'release-seed', 'seed-v1', now() - interval '5 minutes')`,
      [extractId, caseId, { source: seedSource, institution_name: 'Synthetic Bank' }],
    )
    await this.client.query(
      `insert into case_validation_runs (id, case_id, extract_run_id, missing_fields, ambiguities, questions_to_user,
         validation_summary, status, source, model_name, prompt_version, schema_version, is_valid, raw_output, created_at)
       values ($1, $2, $3, '[]', '[]', '[]', 'Synthetic fixture is complete.', 'valid', 'rules', 'release-seed',
         'seed-v1', 'v1', true, $4, now() - interval '4 minutes')`,
      [validationId, caseId, extractId, { source: seedSource }],
    )
  }

  async decision(caseId: string, lineage: { extractId?: string; validationId?: string } = {}) {
    await this.client.query(
      `insert into case_decision_runs (id, case_id, decision_json, eligibility_status, model_name, prompt_version,
         extract_run_id, validation_run_id, created_at)
       values ($1, $2, $3, 'eligible', 'release-seed', 'seed-v1', $4, $5, now() - interval '3 minutes')`,
      [
        seedUuid(`${caseId}:decision`),
        caseId,
        { decision_version: 'case_decision_v1', eligibility: { score: 1, status: 'eligible' }, references: [] },
        lineage.extractId ?? null,
        lineage.validationId ?? null,
      ],
    )
  }

  async gap(caseId: string, includeQuestion: boolean) {
    const extractId = seedUuid(`${caseId}:extract`)
    const validationId = seedUuid(`${caseId}:validation`)
    const fieldKey = 'transaction_date'
    const question = {
      question_key: fieldKey,
      field_key: fieldKey,
      question_text: 'What date did the disputed transaction happen?',
      response_type: 'text',
      expected_answer_type: 'text',
    }
    await this.client.query(
      `insert into case_extract_runs (id, case_id, extract_json, missing_fields, model_name, prompt_version)
       values ($1, $2, $3, '["transaction_date"]', 'release-seed', 'seed-v1')`,
      [extractId, caseId, { source: seedSource }],
    )
    await this.client.query(
      `insert into case_validation_runs (id, case_id, extract_run_id, missing_fields, ambiguities, questions_to_user,
         validation_summary, status, source, model_name, prompt_version, schema_version, is_valid, raw_output)
       values ($1, $2, $3, '["transaction_date"]', '[]', $4, $5, 'needs_user', 'rules', 'release-seed', 'seed-v1', 'v1',
         false, $6)`,
      [
        validationId,
        caseId,
        extractId,
        JSON.stringify(includeQuestion ? [question] : []),
        includeQuestion ? 'Synthetic fixture needs one follow-up answer.' : 'Synthetic fixture has missing data only.',
        { source: seedSource },
      ],
    )
    if (!includeQuestion) return
    await this.client.query(
      `insert into case_validation_gap_items (id, validation_run_id, case_id, extract_run_id, field_key, field_label,
         gap_type, severity, question_text, help_text, expected_answer_type, answer_options, source, sort_order, raw_gap,
         raw_question)
       values ($1, $2, $3, $4, $5, 'Transaction date', 'missing_required_field', 'required', $6,
         'Use an approximate date if the exact date is unavailable.', 'text', '[]', $7, 0, $8, $9)`,
      [seedUuid(`${caseId}:gap`), validationId, caseId, extractId, fieldKey, question.question_text, seedSource,
        { source: seedSource }, question],
    )
  }

  async tier0Narrative(caseId: string) {
    await this.client.query(
      `insert into case_narratives (id, case_id, narrative_type, title, text_content, source_ref)
       values ($1, $2, 'tier0_summary', 'Synthetic summary', 'Synthetic free triage summary for a release fixture.', $3)`,
      [seedUuid(`${caseId}:tier0`), caseId, seedSource],
    )
  }

  async caseEntitlement(caseId: string, plan: 'free' | 'self_serve_report' | 'escalation_pack') {
    await this.client.query(
      `insert into case_entitlements (case_id, plan, features, purchased_at, source) values ($1, $2, '{}', now(), $3)`,
      [caseId, plan, seedSource],
    )
  }

  async completedReport(caseId: string, ownerId: string) {
    await this.client.query(
      `insert into reports (id, user_id, case_id, status, report_json) values ($1, $2, $3, 'COMPLETED', '{}')`,
      [seedUuid(`${caseId}:report`), ownerId, caseId],
    )
  }

  // A stored FIDReC pack with synthetic sections (run_fidrec_pack_v1 writes the same shape).
  async fidrecPack(caseId: string, ownerId: string) {
    const pack = {
      report_version: 'fidrec_pack_v1',
      title: 'Synthetic FIDReC pack',
      executive_summary: 'Synthetic release fixture: the complainant disputes one payment.',
      claimant_position: 'Synthetic claimant position.',
      institution_position: 'Synthetic institution position.',
      arguments_for_claimant: [{ text: 'Synthetic point for the complainant.', evidence_ids: [] }],
      arguments_for_institution: [{ text: 'Synthetic point for the institution.', evidence_ids: [] }],
      timeline: [],
      disputed_transactions: [],
      total_loss: null,
      evidence_index: [],
      evidence_checklist: [],
      route: 'If the case goes to adjudication, FIDReC charges individuals a S$50 case fee.',
      rules_assessment: '',
      final_reply_used: false,
      prose_source: 'fallback',
    }
    await this.client.query(
      `insert into reports (id, user_id, case_id, status, report_json, report_type) values ($1, $2, $3, 'COMPLETED', $4, 'fidrec_pack_v1')`,
      [seedUuid(`${caseId}:fidrec-pack`), ownerId, caseId, pack],
    )
  }

  async failedReportJob(caseId: string, ownerId: string) {
    await this.client.query(
      `insert into jobs (id, case_id, user_id, job_type, idempotency_key, status, payload, error, completed_at)
       values ($1, $2, $3, 'post_payment_report_generation', $4, 'failed', $5, 'Synthetic failure for a release fixture.',
         now())`,
      [seedUuid(`${caseId}:job`), caseId, ownerId, `seed:${caseId}`, { source: seedSource }],
    )
  }

  async blockedPurchase(caseId: string, ownerId: string, status: 'paid' | 'partially_refunded' | 'refunded' | 'disputed') {
    // No provider identities on purpose: reconciliation can't complete such a purchase, so a second checkout is
    // refused (409) instead of being fulfilled.
    const purchaseId = seedUuid(`${caseId}:purchase`)
    await this.client.query(
      `insert into case_purchases (id, case_id, user_id, purchased_by_profile_id, product_code, payment_provider, amount,
         currency, payment_status, refunded_amount, paid_at, disputed_at, metadata, created_by_profile_id)
       values ($1, $2, $3, $3, 'self_serve_report', 'stripe', 18, 'SGD', $4,
         case $4 when 'partially_refunded' then 5 when 'refunded' then 18 end, now() - interval '1 day',
         case when $4 = 'disputed' then now() end, $5, $3)`,
      [purchaseId, caseId, ownerId, status, { source: seedSource }],
    )
    return purchaseId
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const outIndex = args.indexOf('--out-dir')
  const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : 'test-results/seed')

  const url = new URL(requiredEnvironment('HARBOR_PREVIEW_DATABASE_URL'))
  const target = `${url.hostname}.${decodeURIComponent(url.username)}`.toLowerCase().split('.')
  if (!target.includes(stagingRef)) throw new Error(`The seed only runs against staging project ${stagingRef}.`)
  if (url.searchParams.get('sslmode') !== 'verify-full') throw new Error('The database URL must use sslmode=verify-full.')
  for (const parameter of ['sslmode', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(parameter)

  const allowlist = JSON.parse(requiredEnvironment('CLERK_RECONCILIATION_USER_ALLOWLIST_JSON')) as Record<string, string>
  const clerkIds = { userA: allowlist.userA, userB: allowlist.userB, deletionUser: allowlist.deletionUser }
  for (const [label, id] of Object.entries(clerkIds)) {
    if (!/^user_[A-Za-z0-9]{3,}$/.test(id ?? '')) throw new Error(`${label} needs one Clerk user ID.`)
    if (id === allowlist.userGolden) throw new Error(`${label} must not be the userGolden identity.`)
  }

  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { ca: requiredEnvironment('HARBOR_PREVIEW_DB_CA'), rejectUnauthorized: true, servername: url.hostname },
  })
  await client.connect()
  try {
    await client.query('begin')
    const ids = {} as Identities
    for (const [label, clerkId] of Object.entries(clerkIds) as Array<[keyof Identities, string]>) {
      const { rows } = await client.query<{ id: string }>('select id from profiles where clerk_id = $1', [clerkId])
      if (rows.length !== 1) throw new Error(`${label} has no staging profile; run the reconciliation first.`)
      ids[label] = rows[0].id
    }
    const seeder = new Seeder(client, ids)
    const { userA, userB, deletionUser } = ids

    // The CI identities keep the default free account entitlement, like any new user: the seeded states reach
    // purchase through case data only. (An earlier seed gave userA a paid account plan, which hid D6.)
    await client.query(
      `update user_entitlements set plan = 'free', features = '{}' where user_id = any($1::uuid[])`,
      [[userA, userB, deletionUser]],
    )

    const state = {} as Record<keyof StateCases, { caseId: string }>
    const add = async (family: keyof StateCases, build: (caseId: string) => Promise<void>, options: { journey?: boolean } = {}) => {
      const caseId = await seeder.createCase(stateCaseNames[family], userA, options)
      await build(caseId)
      state[family] = { caseId }
    }
    await add('layer1Journey', async () => {}, { journey: false })
    await add('layer1Intake', async () => {})
    await add('layer1Gap', (id) => seeder.gap(id, true))
    await add('layer1Evidence', (id) => seeder.intakeResponses(id))
    await add('layer1DraftPending', async (id) => {
      await seeder.intakeResponses(id)
      await seeder.document(id, 'pending', { processed: false, status: 'ready', uploadedMinutesAgo: 10 })
    })
    await add('layer1FreeDraft', async (id) => {
      await seeder.document(id, 'statement', { processed: true, status: 'ready', uploadedMinutesAgo: 10 })
      await seeder.freeLineage(id)
      await seeder.tier0Narrative(id)
    })
    await add('transitionBuyReport', async (id) => {
      await seeder.freeLineage(id)
      await seeder.tier0Narrative(id)
      await seeder.caseEntitlement(id, 'free')
    })
    for (const name of retiredStateCaseNames) await seeder.resetCase(seedUuid(name))
    await add('layer2ConfirmBankFacts', (id) => seeder.caseEntitlement(id, 'self_serve_report'))
    await add('layer2Ready', async (id) => {
      await seeder.caseEntitlement(id, 'self_serve_report')
      await seeder.completedReport(id, userA)
    })
    await add('layer3Unavailable', async (id) => {
      await seeder.caseEntitlement(id, 'self_serve_report')
      await seeder.completedReport(id, userA)
    })
    await add('layer3Tier2', async (id) => {
      await seeder.caseEntitlement(id, 'escalation_pack')
      await seeder.fidrecTimelineAnswered(id)
    })
    await add('layer3FidrecReady', async (id) => {
      await seeder.caseEntitlement(id, 'escalation_pack')
      await seeder.fidrecPack(id, userA)
    })

    const c = releaseCaseNames
    const owned = {
      userA: await seeder.createCase(c.ownedA, userA),
      userB: await seeder.createCase(c.ownedB, userB),
      deletionUser: await seeder.createCase(c.ownedDeletion, deletionUser),
    }

    const protectedCaseId = await seeder.createCase(c.ownershipProtected, userA)
    const protectedQuestionKey = 'release_gate_ownership_probe'
    const originalResponseValue = 'disposable-control-value'
    await client.query(
      `insert into case_responses (case_id, question_key, response_value, response_type) values ($1, $2, $3, 'text')`,
      [protectedCaseId, protectedQuestionKey, originalResponseValue],
    )

    const evidenceUpload = await seeder.createCase(c.evidenceUpload, userA)
    const evidenceGap = await seeder.createCase(c.evidenceGap, userA)
    await seeder.gap(evidenceGap, true)
    const evidenceMissing = await seeder.createCase(c.evidenceMissingQuestions, userA)
    await seeder.gap(evidenceMissing, false)
    const evidenceReady = await seeder.createCase(c.evidenceReady, userA)
    await seeder.document(evidenceReady, 'ready', { processed: true, status: 'ready', uploadedMinutesAgo: 10 })
    const evidenceMixed = await seeder.createCase(c.evidenceMixed, userA)
    await seeder.document(evidenceMixed, 'ready', { processed: true, status: 'ready', uploadedMinutesAgo: 10 })
    await seeder.document(evidenceMixed, 'uploaded', { processed: false, status: 'uploaded', uploadedMinutesAgo: 5 })

    const expiredCaseId = await seeder.createCase(c.collaborationExpired, userA)
    await client.query(
      `insert into case_collaborators (case_id, user_id, invited_by, role, status, can_view, can_edit, can_invite,
         invited_at, accepted_at, expires_at)
       values ($1, $2, $3, 'helper', 'active', true, true, false, now() - interval '30 days', now() - interval '29 days',
         now() - interval '1 day')`,
      [expiredCaseId, userB, userA],
    )
    const expiredEvidenceId = seedUuid(`${expiredCaseId}:evidence`)
    await client.query(
      `insert into evidence (id, case_id, user_id, filename, file_path, file_type, file_size, category)
       values ($1, $2, $3, 'synthetic-receipt.png', $4, 'image/png', 1024, 'other')`,
      [expiredEvidenceId, expiredCaseId, userA, `${expiredCaseId}/evidence/${expiredEvidenceId}.png`],
    )
    // A trigger stores only the SHA-256 of the token; the plaintext lives in the fixture secret.
    const expiredInvitationToken = randomBytes(24).toString('hex')
    await client.query(
      `insert into invitations (case_id, inviter_user_id, invitee_email, role, invitation_token, status, sent_at,
         expires_at)
       values ($1, $2, 'harbor.release.collaborator@example.com', 'helper', $3, 'expired', now() - interval '30 days',
         now() - interval '23 days')`,
      [expiredCaseId, userA, expiredInvitationToken],
    )

    const reportsRunning = await seeder.createCase(c.reportsRunning, userA)
    await seeder.caseEntitlement(reportsRunning, 'self_serve_report')
    const reportsDrafting = await seeder.createCase(c.reportsDrafting, userA)
    await seeder.caseEntitlement(reportsDrafting, 'self_serve_report')
    await seeder.decision(reportsDrafting)
    const reportsReady = await seeder.createCase(c.reportsReady, userA)
    await seeder.caseEntitlement(reportsReady, 'self_serve_report')
    await seeder.completedReport(reportsReady, userA)
    const reportsFailed = await seeder.createCase(c.reportsFailed, userA)
    await seeder.caseEntitlement(reportsFailed, 'self_serve_report')
    await seeder.failedReportJob(reportsFailed, userA)

    // No story: the stage 2 buying rules refuse both packs with story_missing (stage2-plan §3a).
    const paymentsFree = await seeder.createCase(c.paymentsFree, userA, { story: false })
    const buyReportCase = async (name: string) => {
      const id = await seeder.createCase(name, userA)
      await seeder.freeLineage(id)
      await seeder.tier0Narrative(id)
      await seeder.caseEntitlement(id, 'free')
      return id
    }
    const paymentsSelfServe = await buyReportCase(c.paymentsSelfServe)
    const paymentsCancelResume = await buyReportCase(c.paymentsCancelResume)
    const paymentsConcurrent = await buyReportCase(c.paymentsConcurrent)
    const paymentsTier2 = await seeder.createCase(c.paymentsTier2, userA)
    await seeder.caseEntitlement(paymentsTier2, 'self_serve_report')
    await seeder.fidrecRouteOpen(paymentsTier2)
    const paymentsDelayed = await seeder.createCase(c.paymentsDelayed, userA)
    await seeder.tier0Narrative(paymentsDelayed)

    const blocked = {} as HarborReleaseFixtures['payments']['blockedSecondCheckout']
    for (const [key, name, status] of [
      ['paid', c.blockedPaid, 'paid'],
      ['partiallyRefunded', c.blockedPartiallyRefunded, 'partially_refunded'],
      ['refunded', c.blockedRefunded, 'refunded'],
      ['disputed', c.blockedDisputed, 'disputed'],
    ] as const) {
      const caseId = await seeder.createCase(name, userA)
      // Ready to buy, so a second checkout is refused by the existing purchase, not by readiness.
      await seeder.freeLineage(caseId)
      await seeder.tier0Narrative(caseId)
      blocked[key] = { caseId, purchaseId: await seeder.blockedPurchase(caseId, userA, status) }
    }

    const contactCaseId = await seeder.createCase(c.contact, userA)
    await seeder.caseEntitlement(contactCaseId, 'self_serve_report')
    await seeder.completedReport(contactCaseId, userA)
    const privacyCaseId = await seeder.createCase(c.privacy, userA)

    const fixtures: HarborReleaseFixtures = assertReleaseFixtures({
      schemaVersion: 1,
      users: {
        userA: { supabaseUuid: userA, ownedCaseId: owned.userA, disposable: true },
        userB: { supabaseUuid: userB, ownedCaseId: owned.userB, disposable: true },
        deletionUser: { supabaseUuid: deletionUser, ownedCaseId: owned.deletionUser, disposable: true },
      },
      ownership: { protectedCaseId, protectedQuestionKey, originalResponseValue },
      onboarding: { anonymousNarrative: 'Release-gate anonymous narrative that must bootstrap exactly once.' },
      evidence: {
        uploadCaseId: evidenceUpload,
        gapCaseId: evidenceGap,
        missingQuestionsCaseId: evidenceMissing,
        readyCaseId: evidenceReady,
        mixedOutcomeCaseId: evidenceMixed,
      },
      collaboration: { expiredCaseId, expiredEvidenceId, expiredInvitationToken },
      reports: {
        runningCaseId: reportsRunning,
        draftingCaseId: reportsDrafting,
        readyCaseId: reportsReady,
        failedCaseId: reportsFailed,
      },
      payments: {
        freeCaseId: paymentsFree,
        selfServeCheckoutCaseId: paymentsSelfServe,
        tier2CheckoutCaseId: paymentsTier2,
        cancelResumeCaseId: paymentsCancelResume,
        concurrentCheckoutCaseId: paymentsConcurrent,
        delayedEntitlement: { caseId: paymentsDelayed, sessionId: 'cs_test_harbor_release_delayed_entitlement' },
        blockedSecondCheckout: blocked,
      },
      contact: { caseId: contactCaseId, email: 'harbor.release.contact@example.com', expectedOwnerSupabaseUuid: userA },
      privacy: { settingsCaseId: privacyCaseId },
      serviceRole: { protectedPaths: ['/api/edge/decision', '/api/edge/evidence', '/api/edge/report'] },
    })
    const stateJson = JSON.stringify(state)
    parseStateCaseFixtures(stateJson)

    const seeded = await client.query<{ n: string }>(
      'select count(*) as n from cases where id = any($1::uuid[])',
      [[...Object.values(stateCaseNames), ...Object.values(releaseCaseNames)].map(seedUuid)],
    )
    if (apply) {
      await client.query('commit')
    } else {
      await client.query('rollback')
    }
    console.log(`${apply ? 'Seeded' : 'Dry run (rolled back):'} ${seeded.rows[0].n} synthetic cases for userA, userB and deletionUser.`)

    if (apply) {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(resolve(outDir, 'harbor-state-cases.json'), stateJson)
      writeFileSync(resolve(outDir, 'harbor-release-fixtures.json'), JSON.stringify(fixtures))
      console.log(`Wrote harbor-state-cases.json and harbor-release-fixtures.json to ${outDir}`)
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
