export type NavLink = {
  href: string
  label: string
}

import { PUBLISHED_GUIDES } from "./guides/published.mjs"

// Brief W1 §I, §O: "Guides" takes Resources' place once a guide is published; until then, Resources.
export const resourcesOrGuides = (publishedCount: number): NavLink =>
  publishedCount > 0 ? { href: "/guides", label: "Guides" } : { href: "/resources", label: "Resources" }

export const marketingNavLinks: NavLink[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  resourcesOrGuides(PUBLISHED_GUIDES.length),
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
]
