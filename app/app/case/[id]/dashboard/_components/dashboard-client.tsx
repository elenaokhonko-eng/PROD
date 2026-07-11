'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { SiteHeader } from '@/components/site-header'
import { Layer1Shell } from '@/components/state-machine/layer1/layer1-shell'
import type { IntakeAnswers } from '@/components/state-machine/layer1/intake-form'
import { BuyReportCTA } from '@/components/state-machine/transition/buy-report-cta'
import { CheckoutRedirect } from '@/components/state-machine/transition/checkout-redirect'
import { EligibilityGate } from '@/components/state-machine/transition/eligibility-gate'
import { BlockedOnPrereq } from '@/components/state-machine/transition/blocked-on-prereq'
import { PaymentSuccessLanding } from '@/components/state-machine/transition/payment-success-landing'
import { DecisionProgress } from '@/components/state-machine/layer2/decision-progress'
import { ReportDrafting } from '@/components/state-machine/layer2/report-drafting'
import { ReportFailed } from '@/components/state-machine/layer2/report-failed'
import { ReportView } from '@/components/state-machine/layer2/report-view'
import { WaitlistForm, type WaitlistFormValues } from '@/components/state-machine/layer3/waitlist-form'
import { WaitlistConfirmed } from '@/components/state-machine/layer3/waitlist-confirmed'
import { SpecialistCard } from '@/components/state-machine/layer3/specialist-card'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'
import { useStateMachine } from '@/hooks/state-machine/use-state-machine'
import { useCaseEligibility } from '@/hooks/state-machine/layer1/use-case-eligibility'
import { useValidationRun } from '@/hooks/state-machine/layer1/use-validation-run'
import { useSubmitIntake } from '@/hooks/state-machine/layer1/use-submit-intake'
import { useUploadEvidence } from '@/hooks/state-machine/layer1/use-upload-evidence'
import { useCaseDocumentsRealtime } from '@/hooks/state-machine/layer1/use-case-documents-realtime'
import { useTier0Draft } from '@/hooks/state-machine/layer1/use-tier0-draft'
import { useAutoRefireExtract } from '@/hooks/state-machine/layer1/use-auto-refire-extract'
import { useTier0AutoFire } from '@/hooks/state-machine/layer1/use-tier0-auto-fire'
import { useCreateCheckoutSession } from '@/hooks/state-machine/transition/use-create-checkout-session'
import { usePaymentStatus } from '@/hooks/state-machine/transition/use-payment-status'
import { useDecisionRunRealtime } from '@/hooks/state-machine/layer2/use-decision-run-realtime'
import { useReportRealtime } from '@/hooks/state-machine/layer2/use-report-realtime'
import { useJobStatus } from '@/hooks/state-machine/layer2/use-job-status'
import { useSubmitContactRequest } from '@/hooks/state-machine/layer3/use-submit-contact-request'
import {
  getValidationResponseTypes,
  serializeValidationAnswer,
} from '@/lib/validation-gaps'
import {
  GAP_QUESTIONS_FALLBACK_NOTICE,
  validationIndicatesMissingData,
} from '@/lib/validation/gap-flow'
import type { ValidationAnswerValue } from '@/lib/types/validation'

type DashboardClientProps = {
  caseId: string
  initialUser: { id: string; email: string }
}

export default function DashboardClient({ caseId, initialUser }: DashboardClientProps) {
  const searchParams = useSearchParams()
  const { getToken } = useAuth()
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false)
  const [contactSubmitted, setContactSubmitted] = useState(false)
  const [gateBlocked, setGateBlocked] = useState<{ missing: string[]; reason: string } | null>(null)
  const [intakeCompleted, setIntakeCompleted] = useState(false)

  const eligibilityQuery = useCaseEligibility(caseId)
  const validationQuery = useValidationRun(caseId)
  const documentsQuery = useCaseDocumentsRealtime(caseId)
  const tier0DraftQuery = useTier0Draft(caseId)
  const paymentStatusQuery = usePaymentStatus(caseId)
  const decisionQuery = useDecisionRunRealtime(caseId)
  const reportQuery = useReportRealtime(caseId)
  const jobStatusQuery = useJobStatus(caseId)

  const submitIntake = useSubmitIntake()
  const uploadEvidence = useUploadEvidence()
  const createCheckout = useCreateCheckoutSession()
  const submitContact = useSubmitContactRequest()

  useAutoRefireExtract({
    caseId,
    documents: documentsQuery.data,
    hasNarrative: intakeCompleted,
  })
  useTier0AutoFire({
    caseId,
    documents: documentsQuery.data?.map((d) => ({
      id: d.id,
      processing_status: d.processing_status,
      updated_at: d.updated_at ?? null,
    })),
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

  const node = useStateMachine({
    eligibility: eligibilityQuery.data ?? null,
    validation: validationQuery.data ?? null,
    gapItems: validationQuery.gapItems,
    narratives: tier0DraftQuery.data ?? null,
    entitlementPlan: paymentStatusQuery.data?.plan ?? null,
    documents: documentsQuery.data ?? null,
    decision: decisionQuery.data ?? null,
    report: reportQuery.data ?? null,
    jobStatus: jobStatusQuery.data ?? null,
    isCheckoutRedirecting: checkoutRedirecting,
    isIntakeSubmitted: submitIntake.isPending,
    hasSubmittedIntake: intakeCompleted,
    isContactSubmitting: submitContact.isPending,
    isContactSubmitted: contactSubmitted,
  })

  const isPaymentReturn = useMemo(
    () =>
      Boolean(
        searchParams.get('session_id') ||
          searchParams.get('payment') === 'success' ||
          searchParams.get('checkout') === 'success',
      ),
    [searchParams],
  )
  const isAwaitingPaymentConfirmation =
    isPaymentReturn && paymentStatusQuery.data?.plan !== 'self_serve_report'

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

  async function handleGapSave(answers: Record<string, ValidationAnswerValue>) {
    await saveResponses(answers, gapResponseTypes)
    setIntakeCompleted(true)
    await submitIntake.mutateAsync({ caseId, runExtract: true })
  }

  async function handleUpload(files: File[]) {
    await uploadEvidence.mutateAsync({ caseId, files })
  }

  async function handleCheckout() {
    setCheckoutError(null)
    try {
      const { url } = await createCheckout.mutateAsync({ caseId })
      setCheckoutRedirecting(true)
      window.location.assign(url)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Could not start checkout')
    } finally {
      setCheckoutRedirecting(false)
    }
  }

  async function handleContactSubmit(values: WaitlistFormValues & { case_id: string }) {
    await submitContact.mutateAsync({
      case_id: values.case_id,
      first_name: values.first_name,
      last_name: values.last_name,
      email: values.email,
      phone: values.phone,
      age: Number(values.age),
      employment_status: values.employment_status,
      thirty_days_since_last_fi_reply: values.thirty_days_since_last_fi_reply,
      fi_issued_final_response: values.fi_issued_final_response,
      message: values.message || undefined,
    })
    setContactSubmitted(true)
  }

  const renderLayer3 = () => (
    <div className="space-y-6">
      {reportQuery.data ? <ReportView report={reportQuery.data} decision={decisionQuery.data} /> : null}
      <SpecialistCard
        name="GuideBuoy Scam and Fraud Specialist"
        role="Consult and Q&A for rejected bank outcomes and FIDReC escalation"
        whatsappNumber="6590727915"
        caseId={caseId}
      />
      {contactSubmitted ? (
        <WaitlistConfirmed whatsappUrl="https://wa.me/6590727915" />
      ) : (
        <WaitlistForm
          caseId={caseId}
          initialValues={{
            first_name: '',
            last_name: '',
            email: initialUser.email,
            phone: '',
          }}
          isSubmitting={submitContact.isPending}
          errorMessage={submitContact.error?.message ?? null}
          onSubmit={handleContactSubmit}
        />
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto max-w-5xl px-4 py-8">
        {eligibilityQuery.isError ? (
          <StateMachineErrorCard kind="internal" context={eligibilityQuery.error.message} />
        ) : node === 'S1-IntakeForm' ||
          node === 'S1-GapLoop' ||
          node === 'S1-EvidenceUpload' ||
          node === 'S1-Tier0DraftPending' ? (
          <Layer1Shell
            node={node}
            intake={{
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
              isSavingAnswers: submitIntake.isPending,
              answersError: validationErrorMessage ?? submitIntake.error?.message ?? null,
              onSaveAnswers: handleGapSave,
            }}
            evidence={
              node === 'S1-EvidenceUpload'
                ? {
                    documents: documentsQuery.data ?? [],
                    isUploading: uploadEvidence.isPending,
                    activeBatchFileCount: uploadEvidence.isPending
                      ? uploadEvidence.variables?.files.length ?? 0
                      : 0,
                    onUpload: handleUpload,
                    onDeleteDocument: undefined,
                    onRejectFile: (_file, reason) => console.error('[upload-rejected]', reason),
                  }
                : undefined
            }
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
              footerSlot: (
                <div className="pt-4">
                  <BuyReportCTA
                    isStartingCheckout={createCheckout.isPending}
                    errorMessage={checkoutError}
                    onClick={handleCheckout}
                  />
                </div>
              ),
            }}
          />
        ) : isAwaitingPaymentConfirmation ? (
          <PaymentSuccessLanding isConfirming />
        ) : node === 'T-EligibilityGate' ? (
          <>
            <EligibilityGate
              eligibility={eligibilityQuery.data}
              onResult={(result) => {
                if (result.eligible === false) {
                  setGateBlocked({ missing: result.missing, reason: result.blockedReason })
                } else {
                  setGateBlocked(null)
                }
              }}
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
        ) : node === 'T-BuyReportCTA' ? (
          <BuyReportCTA
            isStartingCheckout={createCheckout.isPending}
            errorMessage={checkoutError}
            onClick={handleCheckout}
          />
        ) : node === 'T-CheckoutRedirect' ? (
          <CheckoutRedirect />
        ) : node === 'L2-DecisionRunning' ? (
          <DecisionProgress />
        ) : node === 'L2-ReportDrafting' ? (
          <ReportDrafting decisionPreview={decisionQuery.data?.decision_json ?? null} />
        ) : node === 'L2-ReportFailed' ? (
          <ReportFailed errorMessage={jobStatusQuery.data?.error ?? null} />
        ) : node === 'L2-ReportReady' ? (
          reportQuery.data ? (
            <ReportView report={reportQuery.data} decision={decisionQuery.data} />
          ) : (
            <DecisionProgress />
          )
        ) : node === 'L3-FormFilling' || node === 'L3-Submitting' || node === 'L3-Confirmed' ? (
          renderLayer3()
        ) : (
          <StateMachineErrorCard
            kind="internal"
            context={`Unknown state machine node: ${node}; job status=${jobStatusQuery.data?.status ?? 'n/a'}`}
          />
        )}
      </main>
    </div>
  )
}
