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

  const node = useStateMachine({
    eligibility: eligibilityQuery.data ?? null,
    validation: validationQuery.data ?? null,
    narratives: tier0DraftQuery.data ?? null,
    entitlementPlan: paymentStatusQuery.data?.plan ?? null,
    documents: documentsQuery.data ?? null,
    decision: decisionQuery.data ?? null,
    report: reportQuery.data ?? null,
    isCheckoutRedirecting: checkoutRedirecting,
    isIntakeSubmitted: submitIntake.isPending,
    hasSubmittedIntake: intakeCompleted,
    isContactSubmitting: submitContact.isPending,
    isContactSubmitted: contactSubmitted,
  })
  // #region agent log
  fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'progression-debug',hypothesisId:'H13',location:'dashboard-client.tsx:86',message:'state machine node resolved',data:{node,isIntakePending:submitIntake.isPending,hasSubmittedIntake:intakeCompleted,hasEligibility:Boolean(eligibilityQuery.data),eligibilityPlan:eligibilityQuery.data?.plan ?? null,hasValidation:Boolean(validationQuery.data),missingFieldsCount:validationQuery.data?.missing_fields?.length ?? 0,hasNarrativeSummary:Boolean(tier0DraftQuery.data?.tier0_summary),hasNarrativeChecklist:Boolean(tier0DraftQuery.data?.tier0_evidence_checklist),hasNarrativeSignal:Boolean(tier0DraftQuery.data?.tier0_srf_signal),documentCount:documentsQuery.data?.length ?? 0,readyDocCount:documentsQuery.data?.filter((d)=>d.processing_status==='ready').length ?? 0},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const isPaymentReturn = useMemo(
    () => searchParams.get('session_id') || searchParams.get('payment') === 'success',
    [searchParams],
  )

  async function saveResponses(answers: Record<string, string>) {
    const token = await getToken({ template: 'supabase' })
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H1',location:'dashboard-client.tsx:94',message:'saveResponses getToken resolved',data:{hasToken:Boolean(token),caseIdPresent:Boolean(caseId)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (!token) {
      throw new Error('Missing Supabase token')
    }

    const responses = Object.entries(answers).map(([question_key, response_value]) => ({
      question_key,
      response_value,
      response_type: 'text',
    }))

    const response = await fetch(`/api/cases/${caseId}/responses`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ responses }),
    })
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H2',location:'dashboard-client.tsx:113',message:'saveResponses fetch completed',data:{status:response.status,ok:response.ok},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H2',location:'dashboard-client.tsx:117',message:'saveResponses non-OK body',data:{status:response.status,error:body?.error ?? null},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      throw new Error(body?.error ?? 'Failed to save responses')
    }
  }

  async function handleIntakeSubmit(answers: IntakeAnswers) {
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'progression-debug',hypothesisId:'H14',location:'dashboard-client.tsx:128',message:'handleIntakeSubmit invoked',data:{answerCount:Object.keys(answers).length,caseIdPresent:Boolean(caseId)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    await saveResponses(answers as Record<string, string>)
    setIntakeCompleted(true)
    await submitIntake.mutateAsync({ caseId, runExtract: false })
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'progression-debug',hypothesisId:'H14',location:'dashboard-client.tsx:131',message:'handleIntakeSubmit finished',data:{caseIdPresent:Boolean(caseId)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
  }

  async function handleGapSave(answers: Record<string, string>) {
    await saveResponses(answers)
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
              questions: validationQuery.data?.questions_to_user ?? [],
              isSavingAnswers: submitIntake.isPending,
              answersError: submitIntake.error?.message ?? null,
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
        ) : node === 'T-EligibilityGate' ? (
          <>
            <EligibilityGate
              eligibility={eligibilityQuery.data}
              onResult={(result) => {
                if (!result.eligible) {
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
        ) : isPaymentReturn ? (
          <PaymentSuccessLanding isConfirming={paymentStatusQuery.data?.plan !== 'self_serve_report'} />
        ) : node === 'L2-DecisionRunning' ? (
          <DecisionProgress />
        ) : node === 'L2-ReportDrafting' ? (
          <ReportDrafting decisionPreview={decisionQuery.data?.decision_json ?? null} />
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
