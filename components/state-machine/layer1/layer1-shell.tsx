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
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { EvidenceUploadPanel } from '@/components/state-machine/layer1/evidence-upload-panel'
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
    isSavingAnswers?: boolean
    answersError?: string | null
    onSaveAnswers: (answers: Record<string, ValidationAnswerValue>) => void
  }

  evidence?: {
    documents: CaseDocumentRow[]
    isUploading?: boolean
    activeBatchFileCount?: number
    onUpload: (files: File[]) => void
    onDeleteDocument?: (documentId: string) => void
    onRejectFile?: (file: File, reason: string) => void
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
            onUpload={evidence.onUpload}
            onDelete={evidence.onDeleteDocument}
            onRejected={evidence.onRejectFile}
          />
        </div>
      )

    case 'S1-Tier0DraftPending':
      return (
        <StateMachineLoading
          size="full"
          title="Preparing your free draft"
          description="Up to 15 seconds — we're weaving your story and evidence into a triage summary."
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
