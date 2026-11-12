import type { ReactNode } from 'react'
import { CaseShell } from '@/components/harbor/case-shell'

export default function AuthenticatedCaseLayout({ children }: { children: ReactNode }) {
  return <CaseShell>{children}</CaseShell>
}
