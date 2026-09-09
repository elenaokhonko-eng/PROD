import { NextResponse, type NextRequest } from "next/server"
import { Webhook } from "svix"
import { provisionClerkProfileWithRuntimeDependencies } from "@/lib/server/clerk-profile-provisioner"

export const dynamic = "force-dynamic"

type ClerkWebhookDependencies = {
  signingSecret?: string
  provisionUser(userId: string): Promise<unknown>
}

function verifiedUserCreatedEvent(value: unknown): { type: "user.created"; data: { id: string } } | null {
  if (!value || typeof value !== "object") throw new Error("invalid event")
  const event = value as { type?: unknown; data?: unknown }
  if (event.type !== "user.created") return null
  if (!event.data || typeof event.data !== "object") throw new Error("invalid event")
  const userId = (event.data as { id?: unknown }).id
  if (typeof userId !== "string" || !userId) throw new Error("invalid event")
  return { type: "user.created", data: { id: userId } }
}

export async function handleClerkWebhook(
  request: Request,
  dependencies: ClerkWebhookDependencies,
): Promise<Response> {
  const signingSecret = dependencies.signingSecret?.trim()
  if (!signingSecret) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 500 })
  }

  const rawBody = await request.text()
  let event: unknown
  try {
    event = new Webhook(signingSecret).verify(rawBody, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    })
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 })
  }

  let userCreated: ReturnType<typeof verifiedUserCreatedEvent>
  try {
    userCreated = verifiedUserCreatedEvent(event)
  } catch {
    return NextResponse.json({ error: "Invalid webhook event" }, { status: 400 })
  }
  if (!userCreated) {
    return NextResponse.json({ status: "ignored" })
  }

  try {
    await dependencies.provisionUser(userCreated.data.id)
  } catch {
    return NextResponse.json({ error: "Profile provisioning failed" }, { status: 500 })
  }
  return NextResponse.json({ status: "provisioned" })
}

export async function POST(request: NextRequest) {
  return handleClerkWebhook(request, {
    signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    provisionUser: provisionClerkProfileWithRuntimeDependencies,
  })
}
