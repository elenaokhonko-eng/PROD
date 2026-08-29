import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-harbor-teal-tint px-4 py-10">
      {children}
    </main>
  )
}
