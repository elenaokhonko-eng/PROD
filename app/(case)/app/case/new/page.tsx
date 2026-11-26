import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { NarrativeCapture } from '@/components/landing/narrative-capture'

// CR-2: "Add a new case" stays inside the dashboard: the home page's story box and nothing else.
export default async function NewCasePage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  return (
    <main className="gb-container py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="sr-only">Add a new case</h1>
        <NarrativeCapture variant="case" />
      </div>
    </main>
  )
}
