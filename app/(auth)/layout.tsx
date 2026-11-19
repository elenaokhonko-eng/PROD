import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { AccountButton } from '@/components/harbor/account-button'

// Brief W1 §F: the logo takes people back to the site from sign-in, sign-up, onboarding and invitations. A signed-in
// person (onboarding, invitations) also gets the account button, as on every other page.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-harbor-teal-tint">
      <header className="flex items-center justify-between gap-2 px-4 pt-4">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full pr-2 font-semibold">
          <Image src="/assets/harbor/lumi-72.webp" alt="" width={36} height={36} className="size-9 object-contain" />
          <span>GuideBuoy AI</span>
        </Link>
        <AccountButton />
      </header>
      <main id="main-content" className="flex flex-1 items-center justify-center px-4 py-10">
        {children}
      </main>
    </div>
  )
}
