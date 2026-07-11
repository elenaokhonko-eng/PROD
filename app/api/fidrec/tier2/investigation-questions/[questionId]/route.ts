import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const paramsSchema = z.object({
  questionId: z.string().uuid("questionId must be a valid UUID"),
})

const bodySchema = z
  .object({
    status: z.enum(["open", "answered", "dismissed"]).optional(),
    answer: z.string().nullable().optional(),
  })
  .refine((body) => body.status !== undefined || body.answer !== undefined, {
    message: "At least one of status or answer is required",
  })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ questionId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let questionId: string
  try {
    const resolved = await params
    questionId = paramsSchema.parse(resolved).questionId
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid path params", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid path params" }, { status: 400 })
  }

  let parsedBody: z.infer<typeof bodySchema>
  try {
    parsedBody = bodySchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: questionRow, error: questionError } = await service
    .from("case_investigation_questions")
    .select("id, case_id, answer, status")
    .eq("id", questionId)
    .single()

  if (questionError || !questionRow) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 })
  }

  try {
    await assertCaseAccess({ caseId: questionRow.case_id, userSupabaseUuid: user.supabaseUuid })
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 })
    }
    if (error instanceof CaseAccessDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to update investigation question" }, { status: 500 })
  }

  const nextStatus =
    parsedBody.status ?? (parsedBody.answer !== undefined ? ("answered" as const) : undefined)
  const nextAnswer = parsedBody.answer !== undefined ? parsedBody.answer : questionRow.answer

  if (nextStatus === "answered") {
    const answerText = typeof nextAnswer === "string" ? nextAnswer.trim() : ""
    if (!answerText) {
      return NextResponse.json(
        { error: "answer is required when status is answered" },
        { status: 400 },
      )
    }
  }

  const updatePayload: { status?: string; answer?: string | null } = {}
  if (parsedBody.status !== undefined) {
    updatePayload.status = parsedBody.status
  } else if (parsedBody.answer !== undefined) {
    updatePayload.status = "answered"
  }
  if (parsedBody.answer !== undefined) {
    updatePayload.answer = parsedBody.answer
  }

  const { data, error } = await service
    .from("case_investigation_questions")
    .update(updatePayload)
    .eq("id", questionId)
    .select(
      "id, case_id, source_assertion_id, source_finding_id, source_link_id, question_text, question_type, priority, status, evidence_requested, answer, raw_model_output, created_at, updated_at",
    )
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update investigation question" }, { status: 500 })
  }

  return NextResponse.json({ investigation_question: data })
}
