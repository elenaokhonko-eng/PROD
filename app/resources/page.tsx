import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { marketingNavLinks } from "@/lib/navigation"

export const metadata: Metadata = {
  title: "Resources | GuideBuoy AI",
  description: "Articles, key legal frameworks, and consumer guides for Singapore complaints and scams.",
}

const articles = [
  {
    title: "How to stay calm after a scam incident",
    href: "https://www.scamshield.org.sg/",
    summary: "Grounding tips and immediate actions to protect your accounts.",
  },
  {
    title: "Understanding FIDReC for consumers",
    href: "https://fidrec.com.sg/",
    summary: "When and how to escalate to FIDReC with the right documents.",
  },
]

const legalFrameworks = [
  { title: "MAS E-Payments User Protection Guidelines", href: "https://www.mas.gov.sg" },
  { title: "PDPA Overview", href: "https://www.pdpc.gov.sg" },
  { title: "SPF E-Services (Police Report)", href: "https://eservices.police.gov.sg" },
]

const guides = [
  {
    title: "Prepare your evidence bundle",
    summary: "Screenshots, bank statements, chat logs, and reference numbers in one place.",
  },
  {
    title: "Tell your story once, reuse it",
    summary: "Use the unified report to avoid retyping across agencies and partners.",
  },
  {
    title: "What to do after you file",
    summary: "Track responses, note deadlines, and know when to escalate.",
  },
]

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground">
            {marketingNavLinks.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 space-y-10">
        <div className="space-y-2">
          <Badge variant="outline" className="rounded-full">
            Resources
          </Badge>
          <h1 className="text-3xl font-bold">Stay informed and prepared</h1>
          <p className="text-muted-foreground max-w-3xl">
            Curated articles, key legal frameworks, and simple guides to help you navigate complaints with confidence.
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Articles</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {articles.map((item) => (
              <Card key={item.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">
                    <Link href={item.href} target="_blank" rel="noreferrer" className="hover:underline">
                      {item.title}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{item.summary}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Key Legal Frameworks</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {legalFrameworks.map((item) => (
              <Card key={item.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">
                    <Link href={item.href} target="_blank" rel="noreferrer" className="hover:underline">
                      {item.title}
                    </Link>
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Consumer Guides</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {guides.map((guide) => (
              <Card key={guide.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{guide.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{guide.summary}</CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
