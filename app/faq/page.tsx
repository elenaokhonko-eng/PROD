import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
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
        a: "No. You can type or record your story first. We ask you to use the available secure sign-in options when you are ready to save a case.",
      },
      {
        q: "Can I sign in with Singpass?",
        a: "Not currently. Use the sign-in options shown in GuideBuoy; we will announce Singpass only if that integration becomes available.",
      },
    ],
  },
  {
    category: "Unified Report",
    questions: [
      {
        q: "Which agencies recognise the unified report?",
        a: "The packs help you organise information for a financial institution and, when eligible, a FIDReC escalation. This does not imply endorsement or acceptance by any agency, and you remain responsible for submitting through the official channel.",
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
        a: "The User Pack is free. The FI Pack is SGD 18 and the FIDReC Pack is SGD 188. Any optional service is clearly priced before payment.",
      },
      {
        q: "What is the specialist consult?",
        a: "Specialist consultation is a planned optional service. Bookings stay closed until the fulfilment process and availability are verified.",
      },
      {
        q: "Do you offer pro-bono referrals?",
        a: "Referral options depend on partner availability and eligibility. GuideBuoy will show a request option only when a pathway is available; a referral is not guaranteed.",
      },
    ],
  },
  {
    category: "Privacy & Trust",
    questions: [
      {
        q: "How is my data protected?",
        a: "We use access controls, encrypted connections, consent records, and data-minimisation practices designed around Singapore's PDPA. See the Privacy page for the current details.",
      },
      {
        q: "Who can view my report?",
        a: "Only you (and anyone you explicitly invite) can view the dashboard. Humans at GuideBuoy do not read your report unless you opt into a marketplace service.",
      },
      {
        q: "Can I delete my report?",
        a: "You can submit a deletion request from Settings. We process it according to the retention, legal, and security requirements described in our Privacy notice.",
      },
    ],
  },
]

export default function FAQPage() {
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

          {/* Contact */}
          <Card className="mt-12">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Still have questions?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Email our team with your question. Include your case ID only if it is relevant, and do not send passwords or banking credentials.
              </p>
              <Button asChild className="rounded-full">
                <Link href="mailto:info@guidebuoyai.sg">Email GuideBuoy</Link>
              </Button>
              <div className="rounded-[14px] bg-[var(--gb-tint-teal)] p-4">
                <p className="text-sm text-foreground">
                  <strong>Safety note:</strong> GuideBuoy is not an emergency service. If you are in immediate danger in Singapore, call 999 or 995.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
