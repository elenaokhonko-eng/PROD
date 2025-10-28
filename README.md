# Financial dispute app

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-blue?style=for-the-badge&logo=render)](https://guidebuoyaisg.onrender.com)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/nKEJQChfLLw)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

This app runs on Next.js 14 with Supabase, Stripe, SMTP (Gmail Workspace), and Google Gemini. Production deployments run on Render as a Web Service.

### Render setup

1. Create a new Web Service from your GitHub repo.
2. Environment
   - Runtime: Node 18.x or 22.x
   - Build command: `./render-build.sh`
   - Start command: `pnpm start`
3. Environment variables (Render → Environment)
   - Public (sent to browser):
     - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
     - `NEXT_PUBLIC_SP_PUBLISHABLE_KEY`: Supabase publishable key (RLS enforced)
     - `NEXT_PUBLIC_APP_URL`: Public base URL of your app (e.g. https://guidebuoyaisg.onrender.com)
   - Server-only:
     - `GOOGLE_GENERATIVE_AI_API_KEY`: Google Gemini API key used by AI routes
     - `STRIPE_SECRET_KEY`: Stripe secret
     - `STRIPE_WEBHOOK_SECRET`: Webhook signing secret (if using webhooks)
     - `STRIPE_PRICE_ID_SGD`: Price ID for the SGD plan (configure per pricing)
     - `SMTP_HOST`: e.g., `smtp.guidebuoyai.sg`
     - `SMTP_PORT`: e.g., `465`
     - `SMTP_SECURE`: `true` for 465 (SMTPS) or `false` for 587 (STARTTLS)
     - `SMTP_USER`: e.g., `info@guidebuoyai.sg`
     - `SMTP_PASS`: mailbox/app password
     - `EMAIL_FROM`: e.g., `GuideBuoy AI <info@guidebuoyai.sg>`
     - `EMAIL_FROM_NAME`: e.g., `GuideBuoy AI`
     - `ADMIN_EMAIL`: e.g., `elena.okhonko@guidebuoyai.sg`

Note: Render provides the `PORT` env var automatically; `next start` will bind to it.

### Database migrations

Apply the SQL in `scripts/` to your Supabase/Postgres project in order:

- `scripts/007_create_router_sessions.sql` (required for the router flow)
- `scripts/014_add_case_collaborators_status.sql` (if not already applied)
- `scripts/016_update_evidence_rls.sql` (tightens evidence policies for collaborators)

You can run these via Supabase SQL editor or the Supabase CLI. Ensure Row Level Security (RLS) remains enabled.

### What the Supabase env vars are

- `NEXT_PUBLIC_SUPABASE_URL`: The base URL of your Supabase project (public).
- `NEXT_PUBLIC_SP_PUBLISHABLE_KEY`: Publishable key used by the browser and server with RLS. Keep sensitive operations on the server. Do NOT expose a service role key to the browser.

### Calling external APIs

- Supabase: Use the browser client for user-scoped reads/writes (RLS protects data), and the server client in route handlers for trusted operations.
- OpenAI (LLM/Whisper): Call from server routes only; the client calls your API route.
- Stripe/SMTP (Gmail Workspace): Server-only with the secrets above.

### Rate limiting (production)

The in-memory limiter used in MVPs is not suitable for multi-instance deployments. For production, use a Redis-backed token bucket (e.g., Upstash Redis):

```ts
// Example: simple per-IP token bucket using Upstash Redis REST
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
// 60 requests per minute per identifier
export const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 m") })

// In a Next.js route handler
export async function POST(req: Request) {
  const id = req.headers.get("x-forwarded-for") ?? "anonymous"
  const { success } = await limiter.limit(`transcribe:${id}`)
  if (!success) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 })
  // continue with work...
}
```

Apply per-route budgets appropriate to traffic (e.g., tighter limits on AI/expensive routes, broader on inexpensive reads). Consider user-based identifiers for authenticated users and IP-based for anonymous.

### Router sessions RLS hardening (optional)

The MVP policy allows anonymous inserts and selects tied to a `session_token` via `current_setting('app.session_token', true)`. For production:

- Set a request-scoped session token in middleware and pass it to Postgres using a Postgres setting, then enforce it in RLS.
- Combine with rate limiting to prevent abuse.

Example (conceptual): in middleware/route, set a header or cookie, load it server-side, and set the Postgres setting before queries using `rpc` or `pg_set_config` (Supabase supports this pattern via `postgrest` `Prefer: tx=read-write` and `set_config` in an RPC function).

## Build your app

Continue building your app on:

**[https://v0.app/chat/projects/nKEJQChfLLw](https://v0.app/chat/projects/nKEJQChfLLw)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Render deploys the latest version from this repository

