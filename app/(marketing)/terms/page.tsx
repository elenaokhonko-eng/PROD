import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/harbor/legal-document'
import { loadLegalDocument } from '@/lib/legal/legal-document'

// Published word for word from docs/legal (finding F); the file is read when the page is built.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms for using GuideBuoy AI and its automated complaint-organisation tools.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return <LegalDocumentPage document={loadLegalDocument('terms')} />
}
