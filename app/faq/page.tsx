"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail } from "lucide-react"
import Link from "next/link"
import { marketingNavLinks } from "@/lib/navigation"

const faqData = [
  {
    category: "Getting Started",
    questions: [
      {
        q: "Who can use Singapore's Complaint Helper?",
        a: "Any Singapore resident who experienced a scam, service failure, or unresolved complaint can use Lumi for free. Caregivers, helpers, and SMEs can also organise reports on behalf of someone else.",
      },
      {
        q: "Do I need to create an account before sharing my story?",
        a: "No. You can type or record your story first. We only ask you to sign up (Singpass or email) once your unified report is ready so you can save it securely.",
      },
      {
        q: "Is Singpass required?",
        a: "Singpass is recommended because it proves identity for our B2R partners, but you can still use email/password if you prefer.",
      },
    ],
  },
  {
    category: "Unified Report",
    questions: [
      {
        q: "Which agencies recognise the unified report?",
        a: "The report is formatted for SPF e-services, ScamShield, and partner pilots like FIs or SMEs. When a direct API does not exist yet, you can export a PDF and send it yourself.",
      },
      {
        q: "What is the dynamic evidence checklist?",
        a: "Lumi examines your uploads and flags any missing proof (e.g., transaction confirmation, screenshots, prior police report). Each item links to an upload button so you can complete the record quickly.",
      },
      {
        q: "Can I edit the AI summary?",
        a: "Yes. Module 1 of the Report Hub lets you review and edit the summary, chronology, and tagged parties before exporting anything.",
      },
    ],
  },
  {
    category: "Marketplace & Pricing",
    questions: [
      {
        q: "Is the helper really free?",
        a: "Yes. Recording your story, running the AI interview, and generating exports is 100% free. Optional marketplace services (e.g., paid specialist consults) are clearly labelled before you pay.",
      },
      {
        q: "What is the specialist consult?",
        a: "High-value cases (> S$25k) can book a free 15‑minute triage with a specialist. If you choose a longer engagement, Stripe processes the fee and GuideBuoy remains a neutral platform.",
      },
      {
        q: "Do you offer pro-bono referrals?",
        a: "Yes. You can request a warm handover to SAL-linked clinics or social services directly from Module 5 in the Report Hub.",
      },
    ],
  },
  {
    category: "Privacy & Trust",
    questions: [
      {
        q: "How is my data protected?",
        a: "We follow PDPA guidelines, encrypt data at rest/in transit, and host everything in Singapore. Logs record consent so we can participate in AI Verify pilots.",
      },
      {
        q: "Who can view my report?",
        a: "Only you (and anyone you explicitly invite) can view the dashboard. Humans at GuideBuoy do not read your report unless you opt into a marketplace service.",
      },
      {
        q: "Can I delete my report?",
        a: "Yes. Module 6 includes a one-click “Delete my report” control that wipes the report, evidence, and associated telemetry permanently.",
      },
    ],
  },
]

export default function FAQPage() {
  const [contactForm, setContactForm] = useState({
    email: "",
    topic: "",
    message: "",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1000))

    alert("Thank you for your message! We'll respond within 24 hours.")
    setContactForm({ email: "", topic: "", message: "" })
    setIsSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
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
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold mb-4">Frequently Asked Questions</h1>
            <p className="text-muted-foreground">
              Find answers about Lumi, the unified report, and how our public-good helper works across agencies.
            </p>
          </div>

          {/* FAQ Sections */}
          <div className="space-y-8">
            {faqData.map((category, categoryIndex) => (
              <Card key={categoryIndex}>
                <CardHeader>
                  <CardTitle>{category.category}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {category.questions.map((faq, faqIndex) => (
                      <AccordionItem key={faqIndex} value={`${categoryIndex}-${faqIndex}`}>
                        <AccordionTrigger className="text-left">{faq.q}</AccordionTrigger>
                        <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Contact Form */}
          <Card className="mt-12">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Still have questions?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="topic">Topic</Label>
                  <Select
                    value={contactForm.topic}
                    onValueChange={(value) => setContactForm((prev) => ({ ...prev, topic: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eligibility">Eligibility Questions</SelectItem>
                      <SelectItem value="technical">Technical Support</SelectItem>
                      <SelectItem value="billing">Billing & Payments</SelectItem>
                      <SelectItem value="partnerships">Partnerships</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={contactForm.message}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, message: e.target.value }))}
                    placeholder="Describe your question or issue..."
                    rows={4}
                    required
                  />
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? "Sending..." : "Send Message"}
                </Button>
              </form>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Response Time:</strong> We typically respond within 24 hours during business days. For urgent
                  technical issues, please include your case ID if applicable.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
