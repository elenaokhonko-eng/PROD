'use client'

import { useAuth } from '@clerk/nextjs'

export type CasePackExportFormat = 'pdf' | 'md'

export function useCasePackExport() {
  const { getToken } = useAuth()

  return {
    download: async (caseId: string, format: CasePackExportFormat) => {
      const token = await getToken({ template: 'supabase' })
      if (!token) {
        throw new Error('Missing Supabase token')
      }

      const response = await fetch(`/api/fidrec/tier2/case-pack-export?caseId=${caseId}&format=${format}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const text = await response.text().catch(() => null)
        throw new Error(text ?? `Failed to download case pack (${response.status})`)
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition')
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? `fidrec-case-pack-${caseId}.${format}`

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    },
  }
}
