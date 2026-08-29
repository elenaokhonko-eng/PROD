import { redirect } from 'next/navigation'

export default function CheckoutPage({ params }: { params: { id: string } }) {
  redirect(`/app/case/${params.id}/dashboard`)
}
