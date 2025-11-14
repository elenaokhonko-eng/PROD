"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileSearch, MessageSquare, Users, Zap, Calendar, Eye, UserPlus, Languages, Brain } from "lucide-react"
import Link from "next/link"
import { marketingNavLinks } from "@/lib/navigation"

const comingSoonFeatures = [
  {
    id: "hearing-bundle",
    title: "Hearing Bundle Compiler",
    description: "Automated TOC generation, exhibit numbering, bookmarks, and page-limit compliance checking",
    icon: FileSearch,
    category: "Document Tools",
    eta: "Q2 2025",
  },
  {
    id: "mediation-simulator",
    title: "Mediation Simulator",
    description: "Role-play practice sessions with AI to prepare for your FIDReC mediation",
    icon: MessageSquare,
    category: "Preparation Tools",
    eta: "Q2 2025",
  },
  {
    id: "ocr-extractor",
    title: "OCR & Policy Extractor",
    description: "Auto-tag documents, highlight relevant clauses, and extract key terms from policies",
    icon: Eye,
    category: "AI Tools",
    eta: "Q3 2025",
  },
  {
    id: "assisted-mode",
    title: "Assisted Mode",
    description: "Caregiver invitations with permission controls for seniors and family support",
    icon: UserPlus,
    category: "Accessibility",
    eta: "Q2 2025",
  },
  {
    id: "multilingual",
    title: "Multilingual Support",
    description: "Full platform support for English, Chinese, Malay, and Tamil languages",
    icon: Languages,
    category: "Accessibility",
    eta: "Q3 2025",
  },
  {
    id: "expert-consults",
    title: "Expert Consultations",
    description: "Book paid consultations with financial dispute experts, with integrated payments and notes",
    icon: Users,
    category: "Professional Services",
    eta: "Q4 2025",
  },
  {
    id: "integrations",
    title: "System Integrations",
    description: "Direct handoff to CJTS/FIDReC systems, email inbox sync, and automated filing",
    icon: Zap,
    category: "Automation",
    eta: "Q4 2025",
  },
  {
    id: "harvey-ai",
    title: "Analyze with Harvey",
    description: "Premium AI analysis powered by advanced legal reasoning models",
    icon: Brain,
    category: "AI Tools",
    eta: "Q1 2026",
  },
]

export default function ComingSoonPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground">
                {marketingNavLinks.map((item) => (
                  <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ))}
              </nav>
              <Link href="/app">
                <Button variant="outline" size="sm">
                  Back to App
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold mb-4">Coming Soon</h1>
            <p className="text-muted-foreground text-lg">
              Exciting new features in development to make your dispute resolution journey even smoother
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {comingSoonFeatures.map((feature) => {
              const Icon = feature.icon
              return (
                <Card key={feature.id} className="relative">
                  <div className="absolute top-4 right-4">
                    <Badge variant="secondary" className="text-xs">
                      {feature.eta}
                    </Badge>
                  </div>
                  <CardHeader className="pb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {feature.category}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* CTA Section */}
          <Card className="mt-12 bg-primary/5 border-primary/20">
            <CardContent className="pt-8 pb-8">
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4">Want early access?</h3>
                <p className="text-muted-foreground mb-6">
                  Join our beta program to test new features before they launch and help shape the future of GuideBuoy
                  AI.
                </p>
                <Button size="lg">Join Beta Program</Button>
              </div>
            </CardContent>
          </Card>

          {/* Roadmap */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold mb-6 text-center">Development Roadmap</h2>
            <div className="space-y-4">
              {["Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026"].map((quarter) => {
                const quarterFeatures = comingSoonFeatures.filter((f) => f.eta === quarter)
                if (quarterFeatures.length === 0) return null

                return (
                  <Card key={quarter}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        {quarter}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-2 gap-4">
                        {quarterFeatures.map((feature) => (
                          <div key={feature.id} className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                              <feature.icon className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{feature.title}</p>
                              <p className="text-xs text-muted-foreground">{feature.category}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
