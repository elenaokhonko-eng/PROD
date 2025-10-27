import { redirect } from "next/navigation"

export default async function CaseCheckoutRedirect({ params }: { params: { id: string } }) {
  const caseId = params.id
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId }),
    cache: "no-store",
  })
  const data = await res.json()
  if (res.ok && data.url) {
    redirect(data.url as string)
  }
  redirect(`/app/case/${caseId}/dashboard`)
}
