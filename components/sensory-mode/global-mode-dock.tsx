"use client"

import { usePathname } from "next/navigation"
import { ModeSwitcher } from "./mode-switcher"

const publicShellRoutes = new Set([
  "/",
  "/about",
  "/faq",
  "/how-it-works",
  "/marketplace",
  "/pricing",
  "/resources",
])

export function GlobalModeDock() {
  const pathname = usePathname()
  if (publicShellRoutes.has(pathname)) return null

  return (
    <div className="fixed right-4 top-4 z-50">
      <ModeSwitcher />
    </div>
  )
}
