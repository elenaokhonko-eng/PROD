'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Layer1Shell } from '@/components/state-machine/layer1/layer1-shell'
import type { IntakeAnswers } from '@/components/state-machine/layer1/intake-form'
import { BuyReportCTA } from '@/components/state-machine/transition/buy-report-cta'
import { CheckoutRedirect } from '@/components/state-machine/transition/checkout-redirect'
import {
  EligibilityGate,
  type EligibilityGateResult,
} from '@/components/state-machine/transition/eligibility-gate'
import { BlockedOnPrereq } from '@/components/state-machine/transition/blocked-on-prereq'
import { PaymentSuccessLanding } from '@/components/state-machine/transition/payment-success-landing'
import { PaymentCancelled } from '@/components/state-machine/transition/payment-cancelled'
import { DecisionProgress } from '@/components/state-machine/layer2/decision-progress'
import { ReportDrafting } from '@/components/state-machine/layer2/report-drafting'
import { ReportFailed } from '@/components/state-machine/layer2/report-failed'
import { ReportView } from '@/components/state-machine/layer2/report-view'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'
import { useStateMachine } from '@/hooks/state-machine/use-state-machine'
import { useCaseFacts } from '@/hooks/state-machine/facts/use-case-facts'
import { useCaseEligibility } from '@/hooks/state-machine/layer1/use-case-eligibility'
import { useValidationRun } from '@/hooks/state-machine/layer1/use-validation-run'
import { useIntakeCompletion } from '@/hooks/state-machine/layer1/use-intake-completion'
import { useSubmitIntake } from '@/hooks/state-machine/layer1/use-submit-intake'
import { UploadRefusedError, UsageLimitError, useUploadEvidence } from '@/hooks/state-machine/layer1/use-upload-evidence'
import { useDeleteEvidence } from '@/hooks/state-machine/layer1/use-delete-evidence'
import { EVIDENCE_SKIPPED_KEY, useEvidenceSkipped } from '@/hooks/state-machine/facts/use-evidence-skipped'
import { useCaseDocumentsRealtime } from '@/hooks/state-machine/layer1/use-case-documents-realtime'
import { documentsBeingRead, PACK_NAMES, PackEvidenceChecklist } from '@/components/state-machine/facts/pack-evidence'
import { checkPackEvidence, type EvidenceItem, type PackProduct } from '@/lib/billing/evidence-minimums'
import { useTier0Draft } from '@/hooks/state-machine/layer1/use-tier0-draft'
import { useQueryClient } from '@tanstack/react-query'
import { useJourneyAnswered } from '@/hooks/state-machine/facts/use-journey-answered'
import { useFidrecTimeline } from '@/hooks/state-machine/facts/use-fidrec-timeline'
import { qk } from '@/hooks/state-machine/query-keys'
import { ConfirmAndEvaluate } from '@/components/state-machine/facts/confirm-and-evaluate'
import { JourneyQuestions } from '@/components/state-machine/facts/journey-questions'
import { NextSteps, RecommendationNotes } from '@/components/state-machine/facts/next-steps'
import { EvidenceUploadPanel } from '@/components/state-machine/layer1/evidence-upload-panel'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { useAutoRefireExtract } from '@/hooks/state-machine/layer1/use-auto-refire-extract'
import { useCreateCheckoutSession, type ProductKey } from '@/hooks/state-machine/transition/use-create-checkout-session'
import { usePaymentStatus } from '@/hooks/state-machine/transition/use-payment-status'
import { useDecisionRunRealtime } from '@/hooks/state-machine/layer2/use-decision-run-realtime'
import { useReportRealtime } from '@/hooks/state-machine/layer2/use-report-realtime'
import { FidrecTimelineForm, FidrecWaiting } from '@/components/state-machine/facts/fidrec-timeline'
import { fidrecTimelineCheck, singaporeToday, type FidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { saveFidrecTimeline } from '@/lib/journey/save-fidrec-timeline'
import { useJobStatus } from '@/hooks/state-machine/layer2/use-job-status'
import { FidrecPackView } from '@/components/state-machine/layer3/fidrec-pack-view'
import { FidrecOffer } from '@/components/state-machine/transition/fidrec-offer'
import type { FidrecPackJson } from '@/lib/types/report'
import {
  getValidationResponseTypes,
  serializeValidationAnswer,
} from '@/lib/validation-gaps'
import {
  GAP_QUESTIONS_FALLBACK_NOTICE,
  validationIndicatesMissingData,
} from '@/lib/validation/gap-flow'
import type { ValidationAnswerValue } from '@/lib/types/validation'
import { noteProblem } from '@/lib/report-problem'
import { parsePack } from '@/lib/journey/pack-case'
import { documentLimit } from '@/lib/upload-limits'

type DashboardClientProps = {
  caseId: string
  initialCaseSnapshot: {
    institutionName: string | null
    claimAmount: number | null
  }
  priceLabels: {
    report: string
    tier2: string
  }
}

const GAP_SAVE_ERROR = "We couldn't save your answers. Please try again; if it keeps happening, email info@guidebuoyai.sg."

export default function DashboardClient({ caseId, initialCaseSnapshot, priceLabels }: DashboardClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // A pack button brought the person to this case (?pack=): the offer shows whatever step the case is on. Only the
  // address says so, nothing is remembered, and nothing is bought until the button is pressed.
  const askedPack = parsePack(searchParams.get('pack'))
  const { getToken } = useAuth()
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutProduct, setCheckoutProduct] = useState<ProductKey | null>(null)
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false)
  const [gateBlocked, setGateBlocked] = useState<{ missing: string[]; reason: string } | null>(null)
  const [intakeCompleted, setIntakeCompleted] = useState(false)
  const handleEligibilityResult = useCallback((result: EligibilityGateResult) => {
    if (result.eligible === false) {
      setGateBlocked({ missing: result.missing, reason: result.blockedReason })
      return
    }
    setGateBlocked(null)
  }, [])

  const eligibilityQuery = useCaseEligibility(caseId)
  const validationQuery = useValidationRun(caseId)
  const intakeCompletionQuery = useIntakeCompletion(caseId)
  const journeyQuery = useJourneyAnswered(caseId)
  const evidenceSkippedQuery = useEvidenceSkipped(caseId)
  const fidrecTimelineQuery = useFidrecTimeline(caseId)
  const [editingTimeline, setEditingTimeline] = useState(false)
  const fidrecCheck = fidrecTimelineQuery.data ? fidrecTimelineCheck(fidrecTimelineQuery.data, singaporeToday()) : null
  const [skippingEvidence, setSkippingEvidence] = useState(false)
  const queryClient = useQueryClient()
  const [journeySaving, setJourneySaving] = useState(false)
  const [journeyError, setJourneyError] = useState<string | null>(null)
  const documentsQuery = useCaseDocumentsRealtime(caseId)
  const tier0DraftQuery = useTier0Draft(caseId)
  const paymentStatusQuery = usePaymentStatus(caseId)
  const isReportPaid = ['self_serve_report', 'escalation_pack'].includes(paymentStatusQuery.data?.plan ?? '')
  const decisionQuery = useDecisionRunRealtime(caseId, { poll: isReportPaid })
  const reportQuery = useReportRealtime(caseId, { poll: isReportPaid })
  const jobStatusQuery = useJobStatus(caseId)

  const submitIntake = useSubmitIntake()
  const [gapSaveError, setGapSaveError] = useState<string | null>(null)
  const [isSavingGap, setIsSavingGap] = useState(false)
  const uploadEvidence = useUploadEvidence()
  const deleteEvidence = useDeleteEvidence(caseId)
  const createCheckout = useCreateCheckoutSession()
  // The FIDReC pack is its own stored report (run_fidrec_pack_v1); reportQuery is the bank pack.
  const fidrecReportQuery = useReportRealtime(caseId, { kind: 'fidrec' })
  const hasSubmittedIntake = intakeCompleted || intakeCompletionQuery.data === true

  useAutoRefireExtract({
    caseId,
    documents: documentsQuery.data,
    hasNarrative: hasSubmittedIntake,
  })

  const gapQuestions = validationQuery.questions
  const gapResponseTypes = useMemo(
    () => getValidationResponseTypes(gapQuestions),
    [gapQuestions],
  )
  const isLoadingGapItems =
    Boolean(validationQuery.validationRunId) && validationQuery.gapItems === undefined
  const validationErrorMessage =
    validationQuery.data?.status === 'error'
      ? validationQuery.data.error_message ?? 'Validation failed while preparing follow-up questions.'
      : null
  const missingQuestionsNotice =
    !isLoadingGapItems &&
    !validationErrorMessage &&
    gapQuestions.length === 0 &&
    validationIndicatesMissingData(validationQuery.data ?? null)
      ? GAP_QUESTIONS_FALLBACK_NOTICE
      : null

  const reportPurchase = paymentStatusQuery.data?.capabilityBilling.capabilities.report
  const [confirmStepShown, setConfirmStepShown] = useState(false)
  const node = useStateMachine({
    reportPurchase: reportPurchase ? { ready: reportPurchase.purchaseReady } : null,
    validation: validationQuery.data ?? null,
    gapItems: validationQuery.gapItems,
    narratives: tier0DraftQuery.data ?? null,
    entitlementPlan: paymentStatusQuery.data?.plan ?? null,
    bankPackOwned: reportPurchase?.entitled ?? null,
    fidrecPackOwned: paymentStatusQuery.data?.capabilityBilling.capabilities.fidrecPack.entitled ?? null,
    fidrecReport: fidrecReportQuery.data ?? null,
    documents: documentsQuery.data ?? null,
    decision: decisionQuery.data ?? null,
    report: reportQuery.data ?? null,
    jobStatus: jobStatusQuery.data ?? null,
    isCheckoutRedirecting: checkoutRedirecting,
    isIntakeSubmitted: submitIntake.isPending,
    hasSubmittedIntake,
    // A failed lookup must not block the case, so an error counts as answered.
    journeyAnswered: journeyQuery.isError ? true : journeyQuery.data ?? null,
    evidenceSkipped: evidenceSkippedQuery.data === true,
    confirmStepShown,
    fidrecWaiting: fidrecCheck?.available === false,
    // A failed lookup must not block the case, so an error counts as answered.
    intakeAnswered: intakeCompleted || intakeCompletionQuery.isError ? true : intakeCompletionQuery.data ?? null,
    fidrecTimelineAnswered: Boolean(fidrecTimelineQuery.data),
  })
  // Until it is known whether a pack's questions are still to be asked, neither they nor the facts are shown.
  const checkingPackQuestions =
    (node === 'L2-ConfirmBankFacts' || node === 'L3-ConfirmFidrecFacts') &&
    (journeyQuery.isPending || intakeCompletionQuery.isPending || tier0DraftQuery.isPending)
  const paidPack = ['self_serve_report', 'escalation_pack'].includes(paymentStatusQuery.data?.plan ?? '')
  useEffect(() => {
    if (node === 'S1-Tier0DraftPending') setConfirmStepShown(true)
  }, [node])

  const isPaymentReturn = useMemo(
    () =>
      Boolean(
        searchParams.get('session_id') ||
          searchParams.get('payment') === 'success' ||
          searchParams.get('checkout') === 'success',
      ),
    [searchParams],
  )
  const paymentReturnProduct = useMemo<ProductKey | null>(() => {
    if (!isPaymentReturn) return null
    const product = searchParams.get('product')
    return product === 'self_serve_report' || product === 'fidrec_tier2_pack' ? product : null
  }, [isPaymentReturn, searchParams])
  const cancelledProduct = useMemo<ProductKey | null>(() => {
    if (searchParams.get('checkout') !== 'cancel') return null
    const product = searchParams.get('product')
    return product === 'self_serve_report' || product === 'fidrec_tier2_pack' ? product : null
  }, [searchParams])
  const isPaymentCancelled = cancelledProduct !== null
  const capabilityBilling = paymentStatusQuery.data?.capabilityBilling
  // App-level ready signal for tests and monitoring: the queries that decide the state have settled. The dashboard
  // keeps polling while work runs, so "network idle" is not a reliable signal.
  const stateReady =
    !eligibilityQuery.isPending &&
    !journeyQuery.isPending &&
    !evidenceSkippedQuery.isPending &&
    !intakeCompletionQuery.isPending &&
    !documentsQuery.isPending &&
    !tier0DraftQuery.isPending &&
    !paymentStatusQuery.isPending
  const paidStagesOff = capabilityBilling?.access.paidStagesEnabled === false
  // A reached limit or a refused file says so in the server's own words; any other failure keeps the generic message.
  const uploadErrorMessage = deleteEvidence.isError
    ? 'The document could not be removed. Please try again.'
    : !uploadEvidence.isError
      ? null
      : uploadEvidence.error instanceof UsageLimitError
        ? uploadEvidence.error.message
        : uploadEvidence.error instanceof UploadRefusedError
          ? uploadEvidence.error.message
          : 'Review the selected file and try again. Your existing case evidence is unchanged.'
  const deletingDocumentId = deleteEvidence.isPending ? deleteEvidence.variables ?? null : null
  const factsHref = `/app/case/${caseId}/facts?stage=free`
  const showStageOneNextSteps =
    paidStagesOff && (node === 'S1-Tier0Draft' || node === 'T-EligibilityGate')
  // An evaluation made from facts that have since changed says so (edge cases, 8 Nov): the confirmed snapshot no
  // longer matches the current facts.
  const showsEvaluation = showStageOneNextSteps || node === 'S1-Tier0Draft'
  const freeFacts = useCaseFacts(caseId, 'free', { enabled: showsEvaluation })
  const freeFactsView = freeFacts.data && !('inProgress' in freeFacts.data) ? freeFacts.data : null
  const evaluationOutOfDateHref =
    freeFactsView?.latestSnapshot && !freeFactsView.latestSnapshot.unchanged ? `/app/case/${caseId}/facts?stage=free` : null
  const reportCapability = capabilityBilling?.capabilities.report
  const fidrecCapability = capabilityBilling?.capabilities.fidrecPack
  const returnedProductIsEntitled =
    paymentReturnProduct === 'fidrec_tier2_pack'
      ? fidrecCapability?.entitled === true
      : paymentReturnProduct === 'self_serve_report'
        ? reportCapability?.entitled === true
        : false
  const hasInvalidPaymentReturn = isPaymentReturn && paymentReturnProduct === null
  const isAwaitingPaymentConfirmation = paymentReturnProduct !== null && !returnedProductIsEntitled
  const reportCheckoutUnavailableReason = paymentStatusQuery.isError
    ? 'Checkout status could not be loaded. Refresh before trying again.'
    : reportCapability?.reconciliationRequired
      ? 'Your payment is recorded and fulfilment is being reconciled. No new checkout is needed.'
      : reportCapability?.canCheckout !== true
        ? 'Checkout is not currently available for this case.'
        : undefined
  const tier2CheckoutUnavailableReason = paymentStatusQuery.isError
    ? 'Checkout status could not be loaded. Refresh before trying again.'
    : fidrecCapability?.reconciliationRequired
      ? 'Your Tier 2 payment is recorded and fulfilment is being reconciled. No new checkout is needed.'
      : 'Tier 2 is not currently available for this case.'

  async function saveResponses(
    answers: Record<string, ValidationAnswerValue>,
    responseTypes: Record<string, string> = {},
  ) {
    const token = await getToken({ template: 'supabase' })
    if (!token) {
      throw new Error('Missing Supabase token')
    }

    const responses = Object.entries(answers).map(([question_key, response_value]) => ({
      question_key,
      response_value: serializeValidationAnswer(response_value),
      response_type: responseTypes[question_key] ?? 'text',
    }))

    const response = await fetch(`/api/cases/${caseId}/responses`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ responses }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? 'Failed to save responses')
    }
  }

  async function handleIntakeSubmit(answers: IntakeAnswers) {
    await saveResponses(answers as Record<string, ValidationAnswerValue>)
    setIntakeCompleted(true)
    await submitIntake.mutateAsync({ caseId, runExtract: false })
  }

  async function handleJourneySave(answers: Record<string, string>) {
    setJourneySaving(true)
    setJourneyError(null)
    try {
      await saveResponses(answers)
      await queryClient.invalidateQueries({ queryKey: qk.case.journey(caseId) })
    } catch (error) {
      setJourneyError(error instanceof Error ? error.message : 'Could not save your answers')
    } finally {
      setJourneySaving(false)
    }
  }

  // A failed save is shown on the form; before, the rejection was dropped and "Save answers" did nothing.
  async function handleGapSave(answers: Record<string, ValidationAnswerValue>) {
    setGapSaveError(null)
    setIsSavingGap(true)
    try {
      await saveResponses(answers, gapResponseTypes)
      setIntakeCompleted(true)
      await submitIntake.mutateAsync({ caseId, runExtract: true })
    } catch {
      noteProblem('answers_not_saved')
      setGapSaveError(GAP_SAVE_ERROR)
    } finally {
      setIsSavingGap(false)
    }
  }

  // Evidence minimums (Elena, 23 Nov 2026): the same check the pack routes and functions enforce.
  const packEvidence = useMemo(() => {
    const documents = (documentsQuery.data ?? []).map((d) => ({ ...d, complainant_item: d.complainant_item ?? null }))
    return { bank: checkPackEvidence('bank', documents), fidrec: checkPackEvidence('fidrec', documents) }
  }, [documentsQuery.data])

  async function handleIdentifyDocument(documentId: string, item: EvidenceItem) {
    const response = await fetch(`/api/cases/${caseId}/documents/${documentId}/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item }),
    })
    if (!response.ok) throw new Error('identify_failed')
    await documentsQuery.refetch()
  }

  const filesUploading = uploadEvidence.isPending ? Math.max(1, uploadEvidence.variables?.files.length ?? 0) : 0

  function packEvidenceChecklist(product: PackProduct) {
    return (
      <PackEvidenceChecklist
        product={product}
        check={packEvidence[product]}
        documents={documentsQuery.data ?? []}
        isUploading={uploadEvidence.isPending}
        uploadingCount={filesUploading}
        onUpload={handleUpload}
        onIdentify={handleIdentifyDocument}
      />
    )
  }

  function handleUpload(files: File[]) {
    deleteEvidence.reset()
    const held = (documentsQuery.data ?? []).filter((d) => d.processing_status !== 'failed').length
    const bought = paymentStatusQuery.data?.capabilityBilling.capabilities
    const limit = documentLimit({
      allow_self_serve_report: bought?.report.entitled === true,
      allow_escalation_pack: bought?.fidrecPack.entitled === true,
    })
    uploadEvidence.mutate({ caseId, files, held, limit })
  }

  function handleDelete(documentId: string) {
    uploadEvidence.reset()
    deleteEvidence.mutate(documentId)
  }

  async function handleSkipEvidence() {
    setSkippingEvidence(true)
    try {
      await saveResponses({ [EVIDENCE_SKIPPED_KEY]: 'yes' })
      await queryClient.invalidateQueries({ queryKey: qk.case.evidenceSkipped(caseId) })
    } catch {
      noteProblem('answers_not_saved')
    } finally {
      setSkippingEvidence(false)
    }
  }

  function canStartCheckout(productKey: ProductKey) {
    if (productKey === 'self_serve_report') return reportCapability?.canCheckout === true
    if (productKey === 'fidrec_tier2_pack') return fidrecCapability?.canCheckout === true
    return false
  }

  // Back from Stripe, the browser can restore this page as it was left, on "Redirecting to secure payment".
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setCheckoutRedirecting(false)
      setCheckoutProduct(null)
    }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  async function handleCheckout(productKey: ProductKey) {
    setCheckoutError(null)
    setCheckoutProduct(productKey)
    if (!canStartCheckout(productKey)) {
      setCheckoutError('Checkout is not currently available for this case.')
      return
    }

    try {
      const checkout = await createCheckout.mutateAsync({ caseId, productKey })
      if (checkout.status === 'reconciled') {
        setCheckoutProduct(null)
        await paymentStatusQuery.refetch()
        return
      }
      setCheckoutRedirecting(true)
      window.location.assign(checkout.url)
    } catch (error) {
      setCheckoutRedirecting(false)
      setCheckoutError(error instanceof Error ? error.message : 'Could not start checkout')
    }
  }

  const fidrecReport = fidrecReportQuery.data?.status === 'COMPLETED' ? fidrecReportQuery.data : null

  async function saveTimeline(timeline: FidrecTimeline) {
    await saveFidrecTimeline(caseId, timeline, getToken)
    await Promise.all([
      fidrecTimelineQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: qk.case.facts(caseId, 'fidrec') }),
    ])
    setEditingTimeline(false)
  }

  const fidrecOffer = (
    <FidrecOffer
      priceLabel={priceLabels.tier2}
      canCheckout={fidrecCapability?.canCheckout === true}
      checkoutInProgress={fidrecCapability?.checkoutInProgress === true}
      isStartingCheckout={createCheckout.isPending && checkoutProduct === 'fidrec_tier2_pack'}
      errorMessage={checkoutProduct === 'fidrec_tier2_pack' ? checkoutError : null}
      onBuy={() => void handleCheckout('fidrec_tier2_pack')}
    />
  )
  // CR-2: the bought FIDReC pack, while its timeline stops it being generated.
  const timelineForm = <FidrecTimelineForm initial={fidrecTimelineQuery.data ?? null} onSave={saveTimeline} />
  const waitingPanel =
    fidrecCapability?.entitled === true && !fidrecReport && fidrecCheck?.available === false ? (
      editingTimeline ? (
        timelineForm
      ) : (
        <section className="space-y-3" aria-label={PACK_NAMES.fidrec}>
          <p className="text-sm font-semibold text-primary">{PACK_NAMES.fidrec}</p>
          <FidrecWaiting check={fidrecCheck} onChange={() => setEditingTimeline(true)} />
          {fidrecCheck.reason === 'complaint_not_raised' && reportCapability?.entitled !== true && reportCapability?.canCheckout === true ? (
            <BuyReportCTA
              priceLabel={priceLabels.report}
              isStartingCheckout={createCheckout.isPending && checkoutProduct === 'self_serve_report'}
              errorMessage={checkoutProduct === 'self_serve_report' ? checkoutError : null}
              onClick={() => void handleCheckout('self_serve_report')}
            />
          ) : null}
        </section>
      )
    ) : null
  // Offered wherever packs can be bought, once paid stages are on and the case doesn't own it.
  const showFidrecOffer = fidrecCapability?.entitled !== true && capabilityBilling?.access.paidStagesEnabled === true
  const renderLayer3 = () => (
    <div className="space-y-6">
      {waitingPanel}
      {/* Part B walk-through (25 Nov, PB-5): each pack's title is written from the case, so with both bought the page
          read as one report shown twice. Each pack is labelled with its name, and a rule separates them. */}
      {fidrecReport ? (
        <section className="space-y-3" aria-labelledby="pack-label-fidrec" data-pack-section="fidrec">
          <p id="pack-label-fidrec" className="text-sm font-semibold text-primary">
            {PACK_NAMES.fidrec}
          </p>
          <FidrecPackView
            pack={(fidrecReport.report_json ?? {}) as FidrecPackJson}
            createdAt={fidrecReport.created_at}
            onDownload={() => window.location.assign(`/api/cases/${caseId}/fidrec-pack/pdf`)}
          />
        </section>
      ) : null}
      {reportQuery.data?.status === 'COMPLETED' ? (
        <section
          className={fidrecReport ? 'space-y-3 border-t pt-8' : 'space-y-3'}
          aria-labelledby={reportQuery.data.report_type === 'bank_pack_v1' ? 'pack-label-bank' : undefined}
          data-pack-section="bank"
        >
          {reportQuery.data.report_type === 'bank_pack_v1' ? (
            <p id="pack-label-bank" className="text-sm font-semibold text-primary">
              {PACK_NAMES.bank}
            </p>
          ) : null}
          <ReportView
            report={reportQuery.data}
            decision={decisionQuery.data}
            onDownload={
              reportQuery.data.report_type === 'bank_pack_v1'
                ? () => window.location.assign(`/api/cases/${caseId}/bank-pack/pdf`)
                : undefined
            }
          />
        </section>
      ) : null}
      <div className="rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Case reference</p>
        <p className="text-muted-foreground">{caseId}</p>
        {initialCaseSnapshot.institutionName ? (
          <p className="mt-2 text-muted-foreground">
            Financial institution: {initialCaseSnapshot.institutionName}
          </p>
        ) : null}
        {initialCaseSnapshot.claimAmount != null ? (
          <p className="text-muted-foreground">
            {/* PB-11 (Part B walk-through, 25 Nov): "S$2,400", as in the packs, not "SGD 2,400". */}
            Reported loss: S${initialCaseSnapshot.claimAmount.toLocaleString('en-SG')}
          </p>
        ) : null}
      </div>

      {showFidrecOffer ? fidrecOffer : null}

      <section className="rounded-xl border border-dashed bg-muted/30 p-5" aria-labelledby="consultation-status">
        <h2 id="consultation-status" className="font-semibold">Human consultation</h2>
        {/* PB-6 (Elena, 25 Nov): the line says how to book, with no greyed button under it. */}
        <p className="mt-2 text-sm text-muted-foreground">
          Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.
        </p>
      </section>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-5xl px-4 py-8" data-harbor-node={node} data-harbor-ready={stateReady ? 'true' : 'false'}>
        {askedPack && ['S1-Journey', 'S1-IntakeForm', 'S1-GapLoop', 'S1-EvidenceUpload', 'S1-Tier0DraftPending', 'L2-ConfirmBankFacts'].includes(node) ? (
          <div className="mb-8" data-asked-pack={askedPack}>
            {askedPack === 'fidrec' ? (
              showFidrecOffer ? fidrecOffer : null
            ) : reportCapability?.entitled !== true && reportCapability?.canCheckout === true ? (
              <BuyReportCTA
                priceLabel={priceLabels.report}
                isStartingCheckout={createCheckout.isPending && checkoutProduct === 'self_serve_report'}
                errorMessage={checkoutProduct === 'self_serve_report' ? checkoutError : null}
                onClick={() => void handleCheckout('self_serve_report')}
              />
            ) : null}
          </div>
        ) : null}
        {eligibilityQuery.isError ? (
          <StateMachineErrorCard kind="internal" context="Case eligibility could not be loaded." />
        ) : isPaymentCancelled ? (
          <PaymentCancelled
            onTryAgain={
              cancelledProduct && canStartCheckout(cancelledProduct)
                ? () => void handleCheckout(cancelledProduct)
                : undefined
            }
            onBackToDraft={
              cancelledProduct === 'self_serve_report'
                ? () => router.replace(`/app/case/${caseId}/dashboard`)
                : undefined
            }
          />
        ) : hasInvalidPaymentReturn ? (
          <StateMachineErrorCard
            kind="internal"
            context="Invalid payment return product"
            onRetry={() => router.replace(`/app/case/${caseId}/dashboard`)}
          />
        ) : isAwaitingPaymentConfirmation ? (
          // PB-19 (Part B walk-through, 25 Nov): checked before the free evaluation's steps, which showed for a moment
          // after paying until the purchase was visible.
          <PaymentSuccessLanding isConfirming />
        ) : checkingPackQuestions || (node === 'S1-IntakeForm' && journeyQuery.isPending) ? (
          <StateMachineLoading title="Loading your case" />
        ) : node === 'S1-Journey' ? (
          <JourneyQuestions timeline={paidPack ? fidrecTimelineQuery.data ?? null : null} isSaving={journeySaving} errorMessage={journeyError} onSave={(answers) => void handleJourneySave(answers)} />
        ) : node === 'S1-Tier0DraftPending' ? (
          // Q2 option (a): the evidence list stays visible while the facts are confirmed.
          <div className="space-y-8">
            <ConfirmAndEvaluate
              caseId={caseId}
              readyDocumentsKey={(documentsQuery.data ?? []).filter((d) => d.processing_status === 'ready').map((d) => d.id).sort().join(',')}
            />
            <EvidenceUploadPanel
              documents={documentsQuery.data ?? []}
              isUploading={uploadEvidence.isPending}
              activeBatchFileCount={uploadEvidence.isPending ? uploadEvidence.variables?.files.length ?? 0 : 0}
              errorMessage={uploadErrorMessage}
              onUpload={handleUpload}
              onDelete={handleDelete}
              deletingId={deletingDocumentId}
            />
          </div>
        ) : showStageOneNextSteps ? (
          <Layer1Shell
            node="S1-Tier0Draft"
            draft={{
              narratives: tier0DraftQuery.data ?? {
                tier0_summary: null,
                tier0_evidence_checklist: null,
                tier0_srf_signal: null,
                other: [],
              },
              outOfDateHref: evaluationOutOfDateHref,
              factsHref,
              footerSlot: (
                <div className="pt-4">
                  <NextSteps caseId={caseId} priceLabels={priceLabels} />
                </div>
              ),
            }}
          />
        ) : node === 'S1-IntakeForm' ||
          node === 'S1-GapLoop' ||
          node === 'S1-EvidenceUpload' ? (
          <Layer1Shell
            node={node}
            confirmFactsHref={`/app/case/${caseId}/facts?stage=free`}
            intake={{
              paid: paidPack,
              isSubmitting: submitIntake.isPending,
              submitError: submitIntake.error?.message ?? null,
              onSubmit: handleIntakeSubmit,
            }}
            gapLoop={{
              questions: validationErrorMessage ? [] : gapQuestions,
              isLoadingGapItems,
              missingQuestionsNotice,
              onRetryGapLoad: () => {
                void validationQuery.gapItemsQuery.refetch()
                void validationQuery.refetch()
              },
              isSavingAnswers: isSavingGap || submitIntake.isPending,
              answersError: validationErrorMessage ?? gapSaveError ?? null,
              onSaveAnswers: handleGapSave,
            }}
            evidence={{
              documents: documentsQuery.data ?? [],
              isUploading: uploadEvidence.isPending,
              activeBatchFileCount: uploadEvidence.isPending
                ? uploadEvidence.variables?.files.length ?? 0
                : 0,
              uploadError: uploadErrorMessage,
              onUpload: handleUpload,
              onDeleteDocument: handleDelete,
              deletingDocumentId,
              onSkip: () => void handleSkipEvidence(),
              isSkipping: skippingEvidence,
            }}
          />
        ) : node === 'S1-Tier0Draft' ? (
          <Layer1Shell
            node="S1-Tier0Draft"
            draft={{
              narratives: tier0DraftQuery.data ?? {
                tier0_summary: null,
                tier0_evidence_checklist: null,
                tier0_srf_signal: null,
                other: [],
              },
              outOfDateHref: evaluationOutOfDateHref,
              factsHref,
              footerSlot: (
                <div className="pt-4">
                  <RecommendationNotes caseId={caseId} />
                  <BuyReportCTA
                    priceLabel={priceLabels.report}
                    disabled={reportCapability?.canCheckout !== true}
                    unavailableReason={reportCheckoutUnavailableReason}
                    isStartingCheckout={createCheckout.isPending && checkoutProduct === 'self_serve_report'}
                    errorMessage={checkoutProduct === 'self_serve_report' ? checkoutError : null}
                    onClick={() => void handleCheckout('self_serve_report')}
                  />
                  {showFidrecOffer ? <div className="mt-6">{fidrecOffer}</div> : null}
                </div>
              ),
            }}
          />
        ) : node === 'T-EligibilityGate' ? (
          <>
            <EligibilityGate
              purchase={
                reportPurchase
                  ? { ready: reportPurchase.purchaseReady, blockedReason: reportPurchase.purchaseBlockedReason }
                  : null
              }
              eligibility={eligibilityQuery.data}
              onResult={handleEligibilityResult}
            />
            {gateBlocked ? (
              <BlockedOnPrereq
                missing={gateBlocked.missing}
                reason={gateBlocked.reason}
                onRetry={() => {
                  setGateBlocked(null)
                  void eligibilityQuery.refetch()
                }}
              />
            ) : null}
          </>
        ) : node === 'T-CheckoutRedirect' ? (
          <CheckoutRedirect />
        ) : node === 'L3-ConfirmFidrecFacts' && fidrecTimelineQuery.isPending ? (
          <StateMachineLoading title="Loading your case" />
        ) : node === 'L3-ConfirmFidrecFacts' && (!fidrecTimelineQuery.data || (editingTimeline && fidrecCheck?.available)) ? (
          // CR-2: the questionnaire is the first step of a bought FIDReC pack.
          timelineForm
        ) : node === 'L3-ConfirmFidrecFacts' && fidrecCheck?.available === false ? (
          <div className="space-y-8">
            {waitingPanel}
            <EvidenceUploadPanel
              documents={documentsQuery.data ?? []}
              isUploading={uploadEvidence.isPending}
              activeBatchFileCount={uploadEvidence.isPending ? uploadEvidence.variables?.files.length ?? 0 : 0}
              errorMessage={uploadErrorMessage}
              onUpload={handleUpload}
              onDelete={handleDelete}
              deletingId={deletingDocumentId}
            />
          </div>
        ) : node === 'L3-ConfirmFidrecFacts' ? (
          <div className="space-y-8">
            <button type="button" className="min-h-11 text-sm underline" onClick={() => setEditingTimeline(true)}>
              Change my answers
            </button>
            <p className="rounded-lg border bg-muted/40 p-4 text-sm">
              If your bank has sent its final reply, upload the letter below before you confirm: the FIDReC pack uses it
              for the bank’s position.
            </p>
            {packEvidenceChecklist('fidrec')}
            <ConfirmAndEvaluate
              caseId={caseId}
              stage="fidrec"
              evidenceReady={packEvidence.fidrec.ready}
              missingEvidence={packEvidence.fidrec.missing}
              documentsUploading={filesUploading}
              documentsReading={documentsBeingRead(documentsQuery.data ?? [])}
              readyDocumentsKey={(documentsQuery.data ?? []).filter((d) => d.processing_status === 'ready').map((d) => d.id).sort().join(',')}
            />
            <EvidenceUploadPanel
              documents={documentsQuery.data ?? []}
              isUploading={uploadEvidence.isPending}
              activeBatchFileCount={uploadEvidence.isPending ? uploadEvidence.variables?.files.length ?? 0 : 0}
              errorMessage={uploadErrorMessage}
              onUpload={handleUpload}
              onDelete={handleDelete}
              deletingId={deletingDocumentId}
            />
          </div>
        ) : node === 'L2-ConfirmBankFacts' ? (
          // Stage 2: after payment, confirm the bank facts and add evidence; the bank pack is generated from them.
          <div className="space-y-8">
            {waitingPanel}
            {packEvidenceChecklist('bank')}
            <ConfirmAndEvaluate
              caseId={caseId}
              stage="bank"
              evidenceReady={packEvidence.bank.ready}
              missingEvidence={packEvidence.bank.missing}
              documentsUploading={filesUploading}
              documentsReading={documentsBeingRead(documentsQuery.data ?? [])}
              readyDocumentsKey={(documentsQuery.data ?? []).filter((d) => d.processing_status === 'ready').map((d) => d.id).sort().join(',')}
            />
            <EvidenceUploadPanel
              documents={documentsQuery.data ?? []}
              isUploading={uploadEvidence.isPending}
              activeBatchFileCount={uploadEvidence.isPending ? uploadEvidence.variables?.files.length ?? 0 : 0}
              errorMessage={uploadErrorMessage}
              onUpload={handleUpload}
              onDelete={handleDelete}
              deletingId={deletingDocumentId}
            />
          </div>
        ) : node === 'L2-DecisionRunning' ? (
          <DecisionProgress />
        ) : node === 'L2-ReportDrafting' ? (
          <ReportDrafting decisionPreview={decisionQuery.data?.decision_json ?? null} />
        ) : node === 'L2-ReportFailed' ? (
          <ReportFailed />
        ) : node === 'L2-ReportReady' ? (
          reportQuery.data ? (
            <ReportView report={reportQuery.data} decision={decisionQuery.data} />
          ) : (
            <DecisionProgress />
          )
        ) : node === 'L3-FormFilling' ||
          node === 'L3-Tier2Ready' ||
          node === 'L3-Submitting' ||
          node === 'L3-Confirmed' ? (
          renderLayer3()
        ) : (
          <StateMachineErrorCard
            kind="internal"
            context="The case view could not be resolved."
          />
        )}
      </main>
    </div>
  )
}
