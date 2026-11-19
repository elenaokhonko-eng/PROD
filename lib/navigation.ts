export type NavLink = {
  href: string
  label: string
}

import { PUBLISHED_GUIDES } from "./guides/published.mjs"

// Brief W1 §I, §O: Resources always stays; "Guides" is added after it once a guide is published (Elena, 19 Nov).
export const menuLinks = (publishedGuides: number): NavLink[] => [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
  ...(publishedGuides > 0 ? [{ href: "/guides", label: "Guides" }] : []),
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
]

export const marketingNavLinks: NavLink[] = menuLinks(PUBLISHED_GUIDES.length)
