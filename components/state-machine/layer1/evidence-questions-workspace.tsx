'use client'

import type { ReactNode } from 'react'
import { FileQuestion, Files } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function EvidenceQuestionsWorkspace({
  questions,
  evidence,
}: {
  questions: ReactNode
  evidence: ReactNode
}) {
  return (
    <Tabs defaultValue="questions" className="w-full">
      <TabsList className="sticky top-16 z-20 grid h-12 w-full grid-cols-2 bg-background/95 shadow-harbor backdrop-blur md:hidden">
        <TabsTrigger value="questions" className="min-h-11 gap-2">
          <FileQuestion className="size-4" aria-hidden="true" />
          Questions
        </TabsTrigger>
        <TabsTrigger value="evidence" className="min-h-11 gap-2">
          <Files className="size-4" aria-hidden="true" />
          Evidence
        </TabsTrigger>
      </TabsList>
      <div className="mt-4 grid gap-6 md:mt-0 md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] md:items-start">
        <TabsContent
          value="questions"
          forceMount
          className="mt-0 data-[state=inactive]:hidden md:block"
        >
          {questions}
        </TabsContent>
        <TabsContent
          value="evidence"
          forceMount
          className="mt-0 data-[state=inactive]:hidden md:block"
        >
          {evidence}
        </TabsContent>
      </div>
    </Tabs>
  )
}
