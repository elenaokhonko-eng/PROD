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
import { SiteHeader } from "@/components/site-header"

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
        a: "No. You can type or record your story first. Sign in with email to save your progress and continue.",
      },
      {
        q: "Can I use Singpass?",
        a: "Singpass sign-in is not currently available. Use email sign-in for now.",
      },
    ],
  },
  {
    category: "Unified Report",
    questions: [
      {
        q: "Can I reuse my report?",
        a: "GuideBuoy helps organise your information into a report. Check the receiving organisation&apos;s requirements before submitting it.",
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
        q: "What does the free helper include?",
        a: "The free helper can organise your story and evidence. Available paid options are shown only when the product catalogue supports them.",
      },
      {
        q: "Can I get human help?",
        a: "Human consultation is not currently available.",
      },
      {
        q: "Do you offer pro-bono referrals?",
        a: "Planned—not currently available through GuideBuoy. There is no active referral service.",
      },
    ],
  },
  {
    category: "Privacy & Trust",
    questions: [
      {
        q: "How is my data protected?",
        a: "We are preparing approved privacy information. Do not rely on this page for legal or security assurances.",
      },
      {
        q: "Who can view my report?",
        a: "Access is controlled by your account and any collaboration permissions the service provides. We are preparing approved privacy information.",
      },
      {
        q: "Can I delete my report?",
        a: "You can request deletion of your data from Settings after you sign in. The request is sent to platform administration and does not delete data immediately."
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

    alert("Thank you for your message.")
    setContactForm({ email: "", topic: "", message: "" })
    setIsSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

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
                  Include your case ID for technical issues when applicable. We do not publish a response-time promise.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
