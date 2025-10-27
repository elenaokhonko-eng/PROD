import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service – GuideBuoy AI",
}

export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>

      <p className="text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <p>
        GuideBuoy AI provides tools and content to help individuals in Singapore understand their options when dealing
        with financial disputes. By using this website, you agree to use the service in accordance with these terms and
        all applicable laws and regulations in Singapore.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">No legal advice</h2>
        <p>
          The information and AI-generated suggestions on this site are for general guidance only. They do not constitute
          legal, financial, or professional advice. You should consult a qualified professional before making decisions
          relating to your dispute.
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
          We may update these Terms of Service from time to time. Continued use after updates constitutes acceptance of
          the revised terms.
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
    </main>
  )
}
