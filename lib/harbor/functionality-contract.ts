export type HarborFlowId =
  | 'narrative-capture'
  | 'evidence-upload'
  | 'questions'
  | 'case-dashboard'
  | 'checkout'
  | 'report-lifecycle'
  | 'tier-2'
  | 'settings'

export interface HarborFlowContract {
  entryRoutes: readonly string[]
  uiOwners: readonly string[]
  hooks: readonly string[]
  api: readonly string[]
  dataOwners: readonly string[]
  analytics: readonly string[]
  redirects: readonly string[]
  constraints?: readonly string[]
}

/**
 * Presentation code may wrap these owners, but must not replace their API,
 * data-access, entitlement, analytics, or redirect responsibilities.
 */
export const HARBOR_FUNCTIONALITY_CONTRACT: Record<HarborFlowId, HarborFlowContract> = {
  'narrative-capture': {
    entryRoutes: ['/', '/router', '/router/classify', '/router/results', '/onboarding'],
    uiOwners: [
      'app/(marketing)/page.tsx',
      'app/router/page.tsx',
      'components/landing/narrative-capture.tsx',
      'components/landing/hero-capture.tsx',
      'app/(auth)/onboarding/page.tsx',
    ],
    hooks: ['createRouterSession', 'getRouterSession', 'updateRouterSession', 'persistPendingNarrative', 'readPendingNarrative'],
    api: [
      'POST /api/router/session',
      'PATCH /api/router/session',
      'POST /api/transcribe',
      'POST /api/router/classify',
      'POST /api/router/assess',
      'POST /api/cases/bootstrap',
    ],
    dataOwners: [
      'browser sessionStorage pending narrative',
      'router_sessions via the existing transient router routes',
      'cases via authenticated POST /api/cases/bootstrap',
    ],
    analytics: ['story_submitted', 'router_conversion_imported', 'page_view'],
    redirects: ['/router/classify', '/router/results', '/sign-up?redirect_url=/onboarding', '/app/case/:caseId/dashboard'],
    constraints: ['The authenticated handoff uses only POST /api/cases/bootstrap; create-from-session is not a UI path.'],
  },
  'evidence-upload': {
    entryRoutes: ['/app/case/:caseId/dashboard'],
    uiOwners: ['components/state-machine/layer1/evidence-upload-panel.tsx'],
    hooks: ['useUploadEvidence', 'useCaseDocumentsRealtime', 'useAutoRefireExtract', 'useTier0AutoFire'],
    api: ['POST /api/evidence/upload', 'POST /api/cases/:caseId/evidence/process', 'POST /api/edge/extract', 'POST /api/edge/tier0'],
    dataOwners: ['case_documents realtime query', 'evidence and case document registration server routes'],
    analytics: ['evidence_uploaded'],
    redirects: [],
  },
  questions: {
    entryRoutes: ['/router/questions', '/app/case/:caseId/dashboard'],
    uiOwners: ['app/router/questions/page.tsx', 'components/state-machine/layer1/gap-question-panel.tsx'],
    hooks: ['useValidationRun', 'useSubmitIntake'],
    api: ['POST /api/router/questions', 'PUT /api/cases/:caseId/responses', 'POST /api/edge/extract'],
    dataOwners: ['router_sessions.user_responses', 'case_validation_runs', 'v_case_validation_gap_items'],
    analytics: [],
    redirects: ['/router/results', '/router'],
  },
  'case-dashboard': {
    entryRoutes: ['/app/case/:caseId/dashboard'],
    uiOwners: ['app/(case)/app/case/[id]/dashboard/page.tsx', 'app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx'],
    hooks: ['useStateMachine', 'useCaseEligibility', 'useValidationRun', 'useTier0Draft'],
    api: ['RPC get_case_eligibility'],
    dataOwners: ['Supabase RLS case access', 'case_extract_runs', 'authoritative state-machine hooks'],
    analytics: ['page_view'],
    redirects: [],
  },
  checkout: {
    entryRoutes: ['/app/case/:caseId/dashboard'],
    uiOwners: ['hooks/state-machine/transition/use-create-checkout-session.ts', 'lib/payments/product-catalogue.ts'],
    hooks: ['useCreateCheckoutSession', 'usePaymentStatus'],
    api: ['POST /api/payments/create-checkout-session'],
    dataOwners: ['case_entitlements', 'PRODUCT_CATALOGUE', 'Stripe webhook fulfilment'],
    analytics: [],
    redirects: ['Stripe-hosted checkout URL', '/app/case/:caseId/dashboard?checkout=success', '/app/case/:caseId/dashboard?checkout=cancel'],
    constraints: [
      'Report and Tier 2 checkout controls require server-returned eligible actions.',
      'Consultation checkout is not exposed while fulfilment availability is unapproved.',
      'The browser return never asserts payment success before server confirmation.',
    ],
  },
  'report-lifecycle': {
    entryRoutes: ['/app/case/:caseId/dashboard'],
    uiOwners: ['components/state-machine/layer2', 'components/state-machine/transition'],
    hooks: ['usePaymentStatus', 'useDecisionRunRealtime', 'useReportRealtime', 'useJobStatus'],
    api: ['GET /api/cases/:caseId/job-status'],
    dataOwners: ['case_entitlements', 'case_decision_runs realtime query', 'reports realtime query', 'worker-owned jobs'],
    analytics: [],
    redirects: [],
    constraints: ['Every material output surface discloses that the output is automated and not human-reviewed.'],
  },
  'tier-2': {
    entryRoutes: ['/app/case/:caseId/dashboard'],
    uiOwners: ['components/state-machine/layer3', 'hooks/state-machine/layer3'],
    hooks: ['useTier2Pack', 'useCasePackExport'],
    api: ['GET /api/fidrec/tier2/case-pack-json', 'GET /api/fidrec/tier2/case-pack-export'],
    dataOwners: ['server-returned run_escalation_pack eligibility', 'case pack endpoints'],
    analytics: [],
    redirects: ['Stripe-hosted checkout URL'],
    constraints: [
      'Tier 2 is automated and not human-reviewed.',
      'Human consultation and contact-request controls remain inactive.',
    ],
  },
  settings: {
    entryRoutes: ['/app/settings'],
    uiOwners: ['app/(case)/app/settings/page.tsx', 'app/(case)/app/settings/_components/settings-client.tsx'],
    hooks: [],
    api: ['POST /api/privacy/export', 'POST /api/privacy/delete-request (inactive until reviewed request and receipt semantics are implemented)'],
    dataOwners: ['server-owned profiles read', 'privacy export route'],
    analytics: [],
    redirects: [],
    constraints: [
      'Request data deletion is visibly inactive and never calls the current destructive endpoint.',
      'Referral generation is not exposed.',
    ],
  },
} as const
