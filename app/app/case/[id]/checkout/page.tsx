import { redirect } from "next/navigation"

export default function LegacyCheckoutPage({ params }: { params: { id: string } }) {
  redirect(`/app/case/${params.id}/dashboard`)
}
