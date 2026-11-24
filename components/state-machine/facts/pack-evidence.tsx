'use client'

/**
 * Evidence minimums for the paid packs (Elena, 23 Nov 2026). Buying is never blocked: a line under each buy button
 * says what generation will need, and after payment a checklist on the generate screen shows each item as added or
 * missing. The checklist reads checkPackEvidence, the same check the web routes and the pack functions enforce.
 */

import { useRef, useState } from 'react'
import { CheckCircle2, Circle, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type EvidenceCheck, type EvidenceItem, type PackProduct } from '@/lib/billing/evidence-minimums'
import type { CaseDocumentRow } from '@/lib/types/documents'

export const PACK_NAMES: Record<PackProduct, string> = { bank: 'Bank dispute pack', fidrec: 'FIDReC pack' }

const NEEDS: Record<PackProduct, string> = {
  bank: 'payment proof (a bank statement or transaction alert) and your police report',
  fidrec:
    'payment proof (a bank statement or transaction alert), your police report, and your bank’s written reply or a copy of your written complaint',
}

const ITEM_LABELS: Record<EvidenceItem, string> = {
  payment_proof: 'Payment proof: a bank statement or transaction alert (SMS, email or app) showing the disputed payments',
  police_report: 'Police report',
  bank_reply_or_complaint: 'Bank’s written reply, or a copy of the written complaint showing its date',
  scam_message: 'Scam message (phishing SMS, email or similar)',
}

const IDENTIFY_LABELS: Record<EvidenceItem, string> = {
  payment_proof: 'This is my payment proof',
  police_report: 'This is my police report',
  bank_reply_or_complaint: 'This is the bank’s reply or my complaint',
  scam_message: 'This is the scam message',
}

/** Under each buy button; it never blocks buying. */
export function PackEvidenceNote({ product }: { product: PackProduct }) {
  return (
    <p className="text-sm text-muted-foreground" data-pack-evidence-note={product}>
      To generate this pack you’ll need: {NEEDS[product]}. You can buy now and add them after.
    </p>
  )
}

export function PackEvidenceChecklist({
  product,
  check,
  documents,
  isUploading,
  onUpload,
  onIdentify,
}: {
  product: PackProduct
  check: EvidenceCheck
  documents: CaseDocumentRow[]
  isUploading: boolean
  onUpload: (files: File[]) => void
  onIdentify: (documentId: string, item: EvidenceItem) => Promise<void>
}) {
  const ready = documents.filter((d) => d.processing_status === 'ready')
  return (
    <section className="space-y-3 rounded-xl border p-5" aria-labelledby="pack-evidence-heading" data-pack-evidence={product}>
      <h2 id="pack-evidence-heading" className="text-lg font-semibold">
        Add these documents to generate your {PACK_NAMES[product]}
      </h2>
      <ul className="space-y-3">
        {check.items.map((status) => (
          <ChecklistItem
            key={status.item}
            item={status.item}
            required={status.required}
            added={status.added}
            candidates={ready.filter((d) => !status.documentIds.includes(d.id))}
            isUploading={isUploading}
            onUpload={onUpload}
            onIdentify={onIdentify}
          />
        ))}
      </ul>
    </section>
  )
}

function ChecklistItem({
  item,
  required,
  added,
  candidates,
  isUploading,
  onUpload,
  onIdentify,
}: {
  item: EvidenceItem
  required: boolean
  added: boolean
  candidates: CaseDocumentRow[]
  isUploading: boolean
  onUpload: (files: File[]) => void
  onIdentify: (documentId: string, item: EvidenceItem) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const selectId = `identify-${item}`

  return (
    <li className="space-y-2 rounded-lg bg-muted/40 p-3" data-evidence-item={item} data-added={added}>
      <div className="flex items-start gap-2">
        {added ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        ) : (
          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="flex-1">
          <p className="text-sm">{ITEM_LABELS[item]}</p>
          <p className="text-xs font-medium text-muted-foreground">{added ? 'Added' : required ? 'Missing' : 'Suggested'}</p>
        </div>
      </div>
      {added ? null : (
        <div className="flex flex-wrap items-center gap-2 pl-7">
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length) onUpload(files)
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => input.current?.click()}>
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            Upload
          </Button>
          {candidates.length ? (
            <>
              <label htmlFor={selectId} className="sr-only">
                Choose one of your documents
              </label>
              <select
                id={selectId}
                className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              >
                <option value="">Choose one of your documents</option>
                {candidates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.original_filename || d.filename}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!chosen || saving}
                onClick={async () => {
                  setSaving(true)
                  setFailed(false)
                  try {
                    await onIdentify(chosen, item)
                    setChosen('')
                  } catch {
                    setFailed(true)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {IDENTIFY_LABELS[item]}
              </Button>
            </>
          ) : null}
          {failed ? (
            <p role="alert" className="w-full text-sm text-destructive">
              The document could not be updated. Please try again.
            </p>
          ) : null}
        </div>
      )}
    </li>
  )
}
