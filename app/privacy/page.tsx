import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy – GuideBuoy AI",
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>

      <p className="text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <p>
        GuideBuoy AI respects your privacy. This policy explains how we collect, use, and safeguard personal data when
        you interact with our service.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">What we collect</h2>
        <p>We may collect your name, contact details, dispute information, and activity logs to power the service.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">How we use your data</h2>
        <p>
          Data is used to operate the platform, provide personalised guidance, improve our models, and comply with legal
          obligations. We do not sell your personal data.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Retention & security</h2>
        <p>
          We keep data only as long as needed for the stated purposes and take reasonable steps to protect it with
          technical and organisational safeguards.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Your rights</h2>
        <p>
          You may request access to, correction of, or deletion of your personal data (subject to legal exceptions). To
          exercise these rights, contact us at{" "}
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
    </main>
  )
}
