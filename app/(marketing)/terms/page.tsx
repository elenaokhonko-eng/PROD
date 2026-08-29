import type { Metadata } from 'next'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms for using GuideBuoy AI and its automated complaint-organisation tools.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <MarketingPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="GuideBuoy AI provides automated tools that help people organise complaint information and understand possible next steps. By using the service, you agree to these terms and applicable law."
    >
      <MarketingSection className="mx-auto flex max-w-3xl flex-col gap-6">
        <p className="text-sm text-muted-foreground">Published 20 March 2026 · Version 1.0</p>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">No legal advice</h2>
        <p>
          The service does not provide legal, financial, medical, or other professional advice. Free drafts, self-serve reports and escalation packs are automated outputs. Generated automatically by GuideBuoy AI. It has not been reviewed by a person. Users remain responsible for checking information before relying on or submitting it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Service availability and external resources</h2>
        <p>
          Features may be unavailable or eligibility-gated. Human consultation and Singpass sign-in are not currently available. References to public agencies or community services do not imply affiliation, endorsement, or a warm hand-off unless expressly stated.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Payments and outcomes</h2>
        <p>
          Any price and product are shown before Stripe checkout. Access is determined by confirmed server-side payment and eligibility records, not by a browser redirect.           GuideBuoy does not guarantee recovery, acceptance by a third party, or response times. Any rights that cannot lawfully be excluded remain unaffected.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Acceptable use</h2>
        <p>
          You agree not to misuse the service, attempt to gain unauthorised access, upload malicious content, or submit
          information that you do not have the right to share. We reserve the right to suspend access if misuse is
          detected.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">User accounts</h2>
        <p>
          You are responsible for safeguarding your login credentials and for all activity under your account. Notify us
          immediately if you suspect unauthorised use.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Changes to these terms</h2>
        <p>
          We may update these Terms of Service from time to time.           Material updates will be published with a new version and effective date.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Contact</h2>
        <p>
          For questions about these terms, please email{" "}
          <a className="underline" href="mailto:info@guidebuoyai.sg">
            info@guidebuoyai.sg
          </a>
          .
        </p>
      </section>
      </MarketingSection>
    </MarketingPage>
  )
}
