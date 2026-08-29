import type { Metadata } from 'next'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How GuideBuoy AI handles personal data when you use the service.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <MarketingPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains the personal data GuideBuoy AI handles when you use the website, create an account, prepare a case, make a payment or contact us."
    >
      <MarketingSection className="mx-auto flex max-w-3xl flex-col gap-6">
        <p className="text-sm text-muted-foreground">Published 20 March 2026 · Version 1.0</p>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">What we collect</h2>
        <p>
          Depending on the features used, this can include account and contact details, complaint narratives, responses, uploaded evidence, case activity, payment references, and technical logs. Payment card details are entered on Stripe-hosted checkout rather than stored in the GuideBuoy interface.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">How we use your data</h2>
        <p>
          Data is used to authenticate accounts, save and process cases, generate requested automated outputs, fulfil confirmed purchases, send service messages, prevent misuse, and meet applicable legal obligations. It is not used to claim a guaranteed case outcome.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Service providers and security</h2>
        <p>
          GuideBuoy uses Clerk for sign-in, Supabase for application data, Stripe for checkout, a Render-hosted worker for background processing, and email delivery infrastructure for service messages. Access controls are applied through the application and Supabase policies. This service-provider description is not a certification or government endorsement.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Retention</h2>
        <p>
          Retention depends on the type of record, the service requested, dispute and security needs, and applicable legal obligations. A request does not cause immediate deletion where review or retention is required.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Your rights</h2>
        <p>
          You may ask about access, correction, export, or deletion of personal data, subject to identity checks and applicable exceptions. A deletion request is reviewed before data is changed. Contact{" "}
          <a className="underline" href="mailto:privacy@guidebuoyai.sg">
            privacy@guidebuoyai.sg
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Contact</h2>
        <p>
          For privacy enquiries, email{" "}
          <a className="underline" href="mailto:privacy@guidebuoyai.sg">
            privacy@guidebuoyai.sg
          </a>
          .
        </p>
      </section>
      </MarketingSection>
    </MarketingPage>
  )
}
