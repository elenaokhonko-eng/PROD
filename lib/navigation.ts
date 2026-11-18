export type NavLink = {
  href: string
  label: string
}

export const marketingNavLinks: NavLink[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  // Brief W1 §I: "Guides" takes this place once a guide is published (Release 5); until then, Resources.
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
]
