"use client"

import { usePathname } from "next/navigation"
import { routeOwnsModeSwitcher } from "@/lib/sensory-mode-shell"
import { ModeSwitcher } from "./mode-switcher"

export function GlobalModeDock() {
  const pathname = usePathname()
  if (routeOwnsModeSwitcher(pathname)) return null

  return (
    <div data-global-mode-dock className="fixed right-4 top-4 z-50">
      <ModeSwitcher />
    </div>
  )
}
