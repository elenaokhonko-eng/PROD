'use client'

import { PublicHeader } from '@/components/harbor/public-header'

type SiteHeaderProps = {
  badge?: string
}

export function SiteHeader(_props: SiteHeaderProps) {
  return <PublicHeader />
}
