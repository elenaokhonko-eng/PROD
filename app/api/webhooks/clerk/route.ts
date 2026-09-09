import type { NextRequest } from "next/server"
import { provisionClerkProfileWithRuntimeDependencies } from "@/lib/server/clerk-profile-provisioner"
import { handleClerkWebhook } from "@/lib/server/clerk-webhook"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return handleClerkWebhook(request, {
    signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    provisionUser: provisionClerkProfileWithRuntimeDependencies,
  })
}
