export type ContractStep = {
  actor: 'workerA' | 'workerB' | 'userA' | 'userB' | 'provider' | 'system'
  action: string
  atMs?: number
  expect: string
}

export type BackendContractCase = {
  id: string
  requirement: string
  fixture: Record<string, unknown>
  steps: ContractStep[]
  invariant: string
}

const leaseStart = Date.parse('2030-01-01T00:00:00.000Z')
const leaseExpiry = leaseStart + 30_000

export const workerLeaseCases: BackendContractCase[] = [
  {
    id: 'expired-owner-cannot-mutate-before-reclaim',
    requirement: 'An expired lease owner cannot heartbeat, defer, write output, or settle even before another worker reclaims the job.',
    fixture: { leaseOwner: 'workerA', leaseExpiresAtMs: leaseExpiry },
    steps: [
      { actor: 'workerA', action: 'heartbeat', atMs: leaseExpiry + 1, expect: 'denied_expired_lease' },
      { actor: 'workerA', action: 'defer', atMs: leaseExpiry + 2, expect: 'denied_expired_lease' },
      { actor: 'workerA', action: 'write_output', atMs: leaseExpiry + 3, expect: 'denied_expired_lease' },
      { actor: 'workerA', action: 'settle_completed', atMs: leaseExpiry + 4, expect: 'denied_expired_lease' },
    ],
    invariant: 'No job, report, decision, evidence, or attempt state changes after lease expiry.',
  },
  {
    id: 'worker-a-to-b-lease-transfer-fences-a',
    requirement: 'A reclaimed lease transfers authority from worker A to worker B and permanently fences A for that attempt.',
    fixture: { leaseOwner: 'workerA', leaseExpiresAtMs: leaseExpiry },
    steps: [
      { actor: 'workerB', action: 'reclaim', atMs: leaseExpiry + 1, expect: 'lease_generation_2' },
      { actor: 'workerA', action: 'heartbeat_generation_1', atMs: leaseExpiry + 2, expect: 'denied_stale_generation' },
      { actor: 'workerA', action: 'settle_generation_1', atMs: leaseExpiry + 3, expect: 'denied_stale_generation' },
      { actor: 'workerB', action: 'write_output_generation_2', atMs: leaseExpiry + 4, expect: 'accepted' },
      { actor: 'workerB', action: 'settle_generation_2', atMs: leaseExpiry + 5, expect: 'completed_once' },
    ],
    invariant: 'Only worker B output is visible and the job reaches one terminal state.',
  },
]

export const evidenceCases: BackendContractCase[] = [
  {
    id: 'evidence-register-and-enqueue-commit-atomically',
    requirement: 'Evidence registration, case-document resolution, and durable enqueue commit as one unit.',
    fixture: { evidenceRows: 1, caseDocuments: 0, jobs: 0 },
    steps: [
      { actor: 'userA', action: 'process_owned_evidence', expect: 'document_and_job_committed' },
      { actor: 'system', action: 'inspect_durable_state', expect: 'one_document_one_job_same_evidence' },
    ],
    invariant: 'A successful response is impossible without both the case document and durable job.',
  },
  {
    id: 'evidence-enqueue-failure-rolls-back-registration',
    requirement: 'An enqueue failure or crash cannot leave a registered document without durable work.',
    fixture: { evidenceRows: 1, caseDocuments: 0, jobs: 0, failpoint: 'after_document_before_enqueue' },
    steps: [
      { actor: 'userA', action: 'process_owned_evidence', expect: 'transaction_failed' },
      { actor: 'system', action: 'inspect_durable_state', expect: 'zero_documents_zero_jobs' },
      { actor: 'userA', action: 'retry_process_owned_evidence', expect: 'one_document_one_job' },
    ],
    invariant: 'Retry is safe and there is no orphan document or duplicate job.',
  },
  {
    id: 'ready-evidence-is-not-downgraded-by-pending-peer',
    requirement: 'A successful evidence result remains successful when another document yields documents_not_ready.',
    fixture: { documents: ['ready', 'processing'] },
    steps: [
      { actor: 'workerA', action: 'settle_ready_document', expect: 'ready' },
      { actor: 'system', action: 'attempt_case_extract', expect: 'documents_not_ready' },
      { actor: 'system', action: 'reload_ready_document', expect: 'ready' },
    ],
    invariant: 'The successful evidence and extraction content are not downgraded or deleted.',
  },
  {
    id: 'expired-collaborator-upload-and-process-denied',
    requirement: 'An expired collaborator cannot upload or process evidence.',
    fixture: { collaboratorStatus: 'expired', owner: 'userA', collaborator: 'userB' },
    steps: [
      { actor: 'userB', action: 'upload_to_user_a_case', expect: 'denied_without_blob_or_row' },
      { actor: 'userB', action: 'process_user_a_evidence', expect: 'denied_without_document_or_job' },
    ],
    invariant: 'Storage, evidence, case_documents, and jobs remain unchanged.',
  },
]

const blockedPurchaseStatuses = ['paid', 'partially_refunded', 'refunded', 'disputed'] as const
export const paymentLifecycleStatuses = ['completed', 'partially_refunded', 'refunded', 'disputed'] as const
export const paymentLifecyclePermutations = permutations(paymentLifecycleStatuses)
export const paymentLifecycleDuplicateCases = paymentLifecyclePermutations.flatMap((events) =>
  events.flatMap((_, duplicateEventIndex) =>
    Array.from({ length: events.length + 1 }, (_, replayAfterEventCount) => ({
      events,
      duplicateEventIndex,
      replayAfterEventCount,
    })),
  ),
)

export const paymentCases: BackendContractCase[] = [
  ...blockedPurchaseStatuses.map((status): BackendContractCase => ({
    id: `${status.replaceAll('_', '-')}-unfulfilled-purchase-blocks-second-checkout`,
    requirement: `An unfulfilled ${status} purchase cannot create a second checkout.`,
    fixture: { paymentStatus: status, fulfilmentStatus: 'unfulfilled', checkoutSessions: 1 },
    steps: [
      { actor: 'userA', action: 'create_same_product_checkout', expect: 'already_purchased_or_recovery_required' },
      { actor: 'system', action: 'inspect_checkout_reservations', expect: 'one' },
    ],
    invariant: 'No second reservation, legacy payment, provider session, entitlement, or job is created.',
  })),
  {
    id: 'concurrent-checkout-reservation-is-single-winner',
    requirement: 'Concurrent checkout reservation has one winner and deterministic replay for the loser.',
    fixture: { concurrentRequests: 2, existingPurchases: 0 },
    steps: [
      { actor: 'userA', action: 'reserve_checkout_request_1', expect: 'winner' },
      { actor: 'userA', action: 'reserve_checkout_request_2', expect: 'same_reservation_or_conflict' },
      { actor: 'system', action: 'inspect_checkout_reservations', expect: 'one' },
    ],
    invariant: 'At most one provider checkout session can be attached to the product/case reservation.',
  },
  {
    id: 'concurrent-completion-is-idempotent',
    requirement: 'Concurrent and duplicate provider completion creates one entitlement and one job.',
    fixture: { providerEventId: 'evt_completion', concurrentDeliveries: 2 },
    steps: [
      { actor: 'provider', action: 'deliver_completion_twice_concurrently', expect: 'acknowledged_idempotently' },
      { actor: 'system', action: 'inspect_fulfilment', expect: 'one_entitlement_one_job' },
    ],
    invariant: 'Purchase completion and enqueue side effects occur once.',
  },
  {
    id: 'payment-lifecycle-permutations-are-monotonic',
    requirement: 'All supported lifecycle orders and duplicate deliveries converge without destructive entitlement changes.',
    fixture: {
      statuses: paymentLifecycleStatuses,
      permutations: paymentLifecyclePermutations,
      duplicateCases: paymentLifecycleDuplicateCases,
    },
    steps: [
      { actor: 'provider', action: 'deliver_all_24_status_permutations', expect: 'deterministic_terminal_ledger' },
      { actor: 'provider', action: 'replay_each_event_at_every_sequence_boundary', expect: 'acknowledged_idempotently' },
      { actor: 'system', action: 'inspect_entitlement_and_outputs', expect: 'preserved_non_destructively' },
    ],
    invariant: 'Refund and dispute events append status/audit state; duplicates do not delete or repeat entitlements, reports, or jobs.',
  },
]

export const migrationPreflightCases: BackendContractCase[] = [
  {
    id: 'migration-preflight-reports-all-historical-conflicts',
    requirement: 'Historical-data preflight fails deterministically before DDL/DML when conflicts exist.',
    fixture: {
      conflicts: ['duplicate_provider_event', 'duplicate_provider_session', 'missing_case_owner', 'owner_mismatch', 'unsupported_payment_status'],
    },
    steps: [
      { actor: 'system', action: 'run_preflight_twice', expect: 'same_sorted_conflict_report' },
      { actor: 'system', action: 'inspect_schema_and_rows', expect: 'unchanged' },
    ],
    invariant: 'No migration mutation occurs until every conflict is resolved; ordering and identifiers are stable.',
  },
]

export const backendBlockerCases = [
  ...workerLeaseCases,
  ...evidenceCases,
  ...paymentCases,
  ...migrationPreflightCases,
]

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]),
  )
}
