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

const faqData = [
  {
    category: "Eligibility",
    questions: [
      {
        q: "What types of disputes can GuideBuoy AI help with?",
        a: "GuideBuoy AI helps with disputes against Singapore financial institutions including banks, insurers, and investment firms. We cover phishing/scam losses, mis-sold products, denied insurance claims, and other consumer financial disputes.",
      },
      {
        q: "Am I eligible for FIDReC?",
        a: "You're eligible if: (1) Your dispute is with a Singapore financial institution, (2) You're an individual consumer (not a business), (3) Your claim is within FIDReC's monetary limits, and (4) The incident occurred within the time limits. Our triage process will assess your eligibility.",
      },
      {
        q: "What are FIDReC's monetary limits?",
        a: "FIDReC handles disputes up to S$100,000 for most financial services, and up to S$100,000 for insurance claims. Some specific limits may apply depending on the type of dispute.",
      },
    ],
  },
  {
    category: "Timelines",
    questions: [
      {
        q: "How long does the FIDReC process take?",
        a: "The timeline varies: Financial institutions have 30 days to respond to your complaint. If unsatisfied, you have 6 months to file with FIDReC. FIDReC mediation typically takes 2-4 months, and adjudication can take 6-12 months.",
      },
      {
        q: "What if I miss a deadline?",
        a: "Missing deadlines can affect your case. The FI must respond within 30 days, and you must file with FIDReC within 6 months of their response. Our tracker helps you monitor all important deadlines.",
      },
      {
        q: "Can I file with FIDReC immediately?",
        a: "No, you must first complain directly to the financial institution and wait for their response (or 30 days to pass) before filing with FIDReC.",
      },
    ],
  },
  {
    category: "Pricing",
    questions: [
      {
        q: "What does the S$49 premium access include?",
        a: "Premium access includes: AI-generated case documents, professional complaint letters, FIDReC forms, case tracker with deadline reminders, filing guide, and 30 days of full platform access.",
      },
      {
        q: "Is there a refund policy?",
        a: "We offer money-back guarantees only for platform faults or technical mis-routing. We cannot refund based on case outcomes, as we provide tools and guidance, not legal representation.",
      },
      {
        q: "What's the difference between Standard and Nominee Service?",
        a: "Standard Service (S$49) provides AI tools and self-service guidance. Nominee Service (S$500 + 10% success fee) includes a qualified representative to handle your case submission and follow-up with FIDReC.",
      },
    ],
  },
  {
    category: "Privacy",
    questions: [
      {
        q: "How is my data protected?",
        a: "We're PDPA compliant with bank-level encryption. Your data is stored securely in Singapore, never shared without consent, and you can export or delete your data anytime.",
      },
      {
        q: "Who can see my case information?",
        a: "Only you can access your case data. Our AI processes your information to generate documents, but no human reviews your case unless you specifically request nominee service.",
      },
      {
        q: "Can I delete my account and data?",
        a: "Yes, you can delete your account and all associated data anytime from your settings page. This action is permanent and cannot be undone.",
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
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <Link href="/app">
              <Button variant="outline" size="sm">
                Back to App
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold mb-4">Frequently Asked Questions</h1>
            <p className="text-muted-foreground">
              Find answers to common questions about GuideBuoy AI and the FIDReC process
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
                      <SelectItem value="legal">Legal Process Questions</SelectItem>
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
