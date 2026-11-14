'use client'

import { useState } from 'react'
import { Building2, Copy, LockKeyhole, ReceiptText, ShieldCheck } from 'lucide-react'

// Brief W1 §B1: four promises directly above the story box, where a person who was just deceived online decides
// whether to type their story here. Item 3 uses Elena's wording (b) of 14 Nov, which matches Privacy Policy §3.
export const COMPANY_UEN = '202545875C'
export const BIZFILE_URL = 'https://www.bizfile.gov.sg/'

export const TRUST_ITEMS = [
  { icon: ShieldCheck, text: 'We never ask for your bank login, PIN or OTP.' },
  { icon: ReceiptText, text: 'Fixed prices. No success fee.' },
  { icon: LockKeyhole, text: 'Private to your account. We never share your case with any bank or authority unless the law requires it.' },
] as const

export function TrustRow() {
  const [copied, setCopied] = useState(false)
  const copyUen = async () => {
    try {
      await navigator.clipboard.writeText(COMPANY_UEN)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <ul aria-label="What GuideBuoy promises" className="grid gap-3 sm:grid-cols-2">
      {TRUST_ITEMS.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-3 rounded-control bg-harbor-surface-subtle p-3 text-sm leading-6 text-foreground">
          <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
      <li className="flex items-start gap-3 rounded-control bg-harbor-surface-subtle p-3 text-sm leading-6 text-foreground">
        <Building2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Singapore company, UEN {COMPANY_UEN}.{' '}
          <a className="font-medium underline" href={BIZFILE_URL} target="_blank" rel="noopener noreferrer">
            Check on ACRA BizFile<span className="sr-only"> (opens in a new tab)</span>
          </a>{' '}
          <button
            type="button"
            onClick={() => void copyUen()}
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 align-middle font-medium text-primary underline-offset-2 hover:underline"
          >
            <Copy className="size-4" aria-hidden="true" />
            {copied ? 'UEN copied' : 'Copy UEN'}
          </button>
          <span className="sr-only" aria-live="polite">{copied ? 'UEN copied' : ''}</span>
        </span>
      </li>
    </ul>
  )
}
