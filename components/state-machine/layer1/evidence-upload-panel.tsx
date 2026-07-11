'use client'

/**
 * Layer 1 evidence upload panel. State Machine nodes `GL-Uploading` /
 * `GL-Processing`.
 *
 * Drag-and-drop + file picker with client-side MIME whitelist (SM R7 /
 * IS §9.6 / §8.1 gotcha 4). Per-file cards show a live processing badge
 * (`pending | parsing | verifying | chunking | extracting | ready | failed`)
 * driven by Realtime — the parent passes in the current list of documents
 * and handles callbacks for upload + delete.
 *
 * Pure presentational.
 */

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { CheckCircle, FileText, Image as ImageIcon, Loader2, Trash2, Upload, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  isAllowedMime,
  type CaseDocumentRow,
  type DocumentProcessingStatus,
} from '@/lib/types/documents'
import { cn } from '@/lib/utils'

export interface EvidenceUploadPanelProps {
  documents: Array<
    Pick<
      CaseDocumentRow,
      'id' | 'original_filename' | 'mime_type' | 'file_size' | 'processing_status' | 'processing_error'
    >
  >
  isUploading?: boolean
  /** When uploading, number of files in the current batch (last drop/pick). */
  activeBatchFileCount?: number
  onUpload: (files: File[]) => void
  onDelete?: (documentId: string) => void
  /** Called when the user drops a blocked file type. Parent can surface a toast. */
  onRejected?: (file: File, reason: string) => void
}

export function EvidenceUploadPanel({
  documents,
  isUploading = false,
  activeBatchFileCount = 0,
  onUpload,
  onDelete,
  onRejected,
}: EvidenceUploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return
    const accepted: File[] = []
    for (const file of Array.from(fileList)) {
      if (isAllowedMime(file.type)) {
        accepted.push(file)
      } else {
        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
        const reason = `${file.name} is not a supported file type. Accepted: PDF, PNG, JPEG, DOCX. Got: ${
          file.type || ext || 'unknown'
        }.`
        onRejected?.(file, reason)
      }
    }
    if (accepted.length > 0) onUpload(accepted)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer?.files ?? null)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files)
  }

  const batchCount = isUploading ? Math.max(1, activeBatchFileCount) : 0
  const allListedProcessedSuccess =
    documents.length > 0 &&
    !isUploading &&
    documents.every((d) => d.processing_status === 'ready')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload supporting evidence</CardTitle>
        <CardDescription>
          Accepted types: PDF, PNG, JPEG, DOCX. We parse each document as it arrives so the draft
          reflects your real paperwork.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isUploading && batchCount > 0 ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            <span>
              Uploading and processing <strong>{batchCount}</strong> file
              {batchCount === 1 ? '' : 's'}&hellip;
            </span>
          </div>
        ) : null}

        {allListedProcessedSuccess ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-950 dark:text-emerald-50"
            role="status"
            aria-live="polite"
          >
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div>
              <p className="font-medium">All files uploaded successfully</p>
              <p className="mt-1 text-muted-foreground">
                Each document below is ready. We&apos;ll move on to your free draft shortly.
              </p>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm">Drag files here, or</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Uploading...
              </>
            ) : (
              'Choose files'
            )}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={[...ALLOWED_MIME_TYPES, ...ALLOWED_FILE_EXTENSIONS].join(',')}
            multiple
            onChange={handleChange}
          />
          <p className="mt-2 text-xs text-muted-foreground">Max file size depends on your plan.</p>
        </div>

        {documents.length > 0 ? (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <DocumentRow doc={doc} onDelete={onDelete} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: EvidenceUploadPanelProps['documents'][number]
  onDelete?: (id: string) => void
}) {
  const Icon = doc.mime_type?.startsWith('image/') ? ImageIcon : FileText
  const status: DocumentProcessingStatus = doc.processing_status ?? 'pending'
  const { label, variant } = describeStatus(status)

  const isReady = status === 'ready'

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3">
      {isReady ? (
        <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.original_filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatSize(doc.file_size)} · {doc.mime_type ?? 'unknown type'}
        </p>
        {doc.processing_error ? (
          <p className="mt-1 text-xs text-destructive">{doc.processing_error}</p>
        ) : null}
      </div>
      <Badge variant={variant}>{isReady ? '✓ Ready' : label}</Badge>
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(doc.id)}
          aria-label={`Remove ${doc.original_filename}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function describeStatus(status: DocumentProcessingStatus): {
  label: string
  variant: BadgeVariant
} {
  switch (status) {
    case 'uploaded':
    case 'pending':
      return { label: 'Queued', variant: 'secondary' }
    case 'parsing':
      return { label: 'Parsing', variant: 'secondary' }
    case 'verifying':
      return { label: 'Verifying', variant: 'secondary' }
    case 'chunking':
      return { label: 'Chunking', variant: 'secondary' }
    case 'extracting':
      return { label: 'Extracting', variant: 'secondary' }
    case 'ready':
      return { label: 'Ready', variant: 'default' }
    case 'failed':
      return { label: 'Failed', variant: 'destructive' }
    default:
      return { label: status, variant: 'outline' }
  }
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Re-export so the error-card component can refer to the same icons. */
export { CheckCircle, XCircle }
