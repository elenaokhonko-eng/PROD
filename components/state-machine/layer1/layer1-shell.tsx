'use client'

/**
 * Layer 1 (Tier 0, free) composition shell. Renders the correct child
 * component for the current State Machine node:
 *
 *   S1-IntakeForm            → IntakeForm only (no upload)
 *   S1-GapLoop               → GapQuestionPanel only (no upload)
 *   S1-EvidenceUpload        → EvidenceUploadPanel (dedicated upload step)
 *   S1-Tier0DraftPending     → StateMachineLoading (full)
 *   S1-Tier0Draft            → Tier0DraftView
 *   (error at any node)      → StateMachineErrorCard
 */

import type { ReactNode } from 'react'
import {
  StateMachineErrorCard,
  type StateMachineErrorKind,
} from '@/components/state-machine/error-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { EvidenceUploadPanel } from '@/components/state-machine/layer1/evidence-upload-panel'
import { EvidenceQuestionsWorkspace } from '@/components/state-machine/layer1/evidence-questions-workspace'
import { GapQuestionPanel } from '@/components/state-machine/layer1/gap-question-panel'
import { IntakeForm, type IntakeAnswers } from '@/components/state-machine/layer1/intake-form'
import { Tier0DraftView } from '@/components/state-machine/layer1/tier0-draft-view'
import type { CaseDocumentRow } from '@/lib/types/documents'
import type { Tier0DraftBundle } from '@/lib/types/narratives'
import type { ValidationAnswerValue, ValidationQuestion } from '@/lib/types/validation'

export type Layer1Node =
  | 'S1-IntakeForm'
  | 'S1-GapLoop'
  | 'S1-EvidenceUpload'
  | 'S1-Tier0DraftPending'
  | 'S1-Tier0Draft'

export interface Layer1ShellError {
  kind: StateMachineErrorKind
  context?: string | Error | null
  onRetry?: () => void
}

export interface Layer1ShellProps {
  node: Layer1Node
  error?: Layer1ShellError | null

  intake?: {
    initialAnswers?: IntakeAnswers
    isSubmitting?: boolean
    submitError?: string | null
    onSubmit: (answers: IntakeAnswers) => void
  }

  gapLoop?: {
    questions: ValidationQuestion[]
    /** True while `v_case_validation_gap_items` is loading for the resolved validation run. */
    isLoadingGapItems?: boolean
    /** When set, render this instead of questions (missing data but no gap rows or legacy questions). */
    missingQuestionsNotice?: string | null
    onRetryGapLoad?: () => void
    isSavingAnswers?: boolean
    answersError?: string | null
    onSaveAnswers: (answers: Record<string, ValidationAnswerValue>) => void
  }

  evidence?: {
    documents: CaseDocumentRow[]
    isUploading?: boolean
    activeBatchFileCount?: number
    uploadError?: string | null
    onUpload: (files: File[]) => void
    onDeleteDocument?: (documentId: string) => void
  }

  draft?: {
    narratives: Tier0DraftBundle
    isRefreshing?: boolean
    onRefresh?: () => void
    footerSlot?: ReactNode
  }
}

export function Layer1Shell({ node, error, intake, gapLoop, evidence, draft }: Layer1ShellProps) {
  if (error) {
    return (
      <StateMachineErrorCard
        kind={error.kind}
        context={error.context ?? null}
        onRetry={error.onRetry}
      />
    )
  }

  switch (node) {
    case 'S1-IntakeForm':
      if (!intake) return <MissingPropsFallback prop="intake" />
      return (
        <div className="mx-auto max-w-2xl">
          <IntakeForm
            initialAnswers={intake.initialAnswers}
            isSubmitting={intake.isSubmitting}
            errorMessage={intake.submitError ?? null}
            onSubmit={intake.onSubmit}
          />
        </div>
      )

    case 'S1-GapLoop':
      if (!gapLoop) return <MissingPropsFallback prop="gapLoop" />
      if (gapLoop.isLoadingGapItems) {
        return (
          <div className="mx-auto max-w-2xl">
            <StateMachineLoading
              size="full"
              title="Loading follow-up questions"
              description="One moment while we load what still needs your input."
            />
          </div>
        )
      }
      if (gapLoop.missingQuestionsNotice) {
        return (
          <div className="mx-auto max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>We need a bit more</CardTitle>
                <CardDescription>Something went wrong preparing the questions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{gapLoop.missingQuestionsNotice}</p>
                {gapLoop.onRetryGapLoad ? (
                  <Button type="button" variant="secondary" onClick={() => gapLoop.onRetryGapLoad?.()}>
                    Try again
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )
      }
      if (evidence) {
        return (
          <EvidenceQuestionsWorkspace
            questions={
              <GapQuestionPanel
                questions={gapLoop.questions}
                isSubmitting={gapLoop.isSavingAnswers}
                errorMessage={gapLoop.answersError ?? null}
                onSave={gapLoop.onSaveAnswers}
              />
            }
            evidence={
              <EvidenceUploadPanel
                documents={evidence.documents}
                isUploading={evidence.isUploading}
                activeBatchFileCount={evidence.activeBatchFileCount}
                errorMessage={evidence.uploadError}
                onUpload={evidence.onUpload}
                onDelete={evidence.onDeleteDocument}
              />
            }
          />
        )
      }
      return (
        <div className="mx-auto max-w-2xl">
          <GapQuestionPanel
            questions={gapLoop.questions}
            isSubmitting={gapLoop.isSavingAnswers}
            errorMessage={gapLoop.answersError ?? null}
            onSave={gapLoop.onSaveAnswers}
          />
        </div>
      )

    case 'S1-EvidenceUpload':
      if (!evidence) return <MissingPropsFallback prop="evidence" />
      return (
        <div className="mx-auto max-w-3xl space-y-6">
          <EvidenceUploadPanel
            documents={evidence.documents}
            isUploading={evidence.isUploading}
            activeBatchFileCount={evidence.activeBatchFileCount}
            errorMessage={evidence.uploadError}
            onUpload={evidence.onUpload}
            onDelete={evidence.onDeleteDocument}
          />
        </div>
      )

    case 'S1-Tier0DraftPending':
      return (
        <StateMachineLoading
          size="full"
          title="Preparing your free draft"
          description="GuideBuoy is organising your story and ready evidence. The latest status will appear here."
        />
      )

    case 'S1-Tier0Draft':
      if (!draft) return <MissingPropsFallback prop="draft" />
      return (
        <Tier0DraftView
          narratives={draft.narratives}
          isRefreshing={draft.isRefreshing}
          onRefresh={draft.onRefresh}
          footerSlot={draft.footerSlot}
        />
      )

    default: {
      const _exhaustive: never = node
      return <MissingPropsFallback prop={`node: ${String(_exhaustive)}`} />
    }
  }
}

function MissingPropsFallback({ prop }: { prop: string }) {
  return (
    <StateMachineErrorCard
      kind="internal"
      context={`Layer 1 shell missing required props for current node: ${prop}. This is a frontend bug.`}
    />
  )
}
