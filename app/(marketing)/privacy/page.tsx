import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/harbor/legal-document'
import { loadLegalDocument } from '@/lib/legal/legal-document'

// Published word for word from docs/legal (finding F); the file is read when the page is built.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How GuideBuoy AI handles personal data when you use the service.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return <LegalDocumentPage document={loadLegalDocument('privacy')} />
}
