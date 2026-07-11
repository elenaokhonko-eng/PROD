# Legacy auth and router archive

Archived before Slice 5 cleanup on top of commit `aec0233`.

This file is a recovery map for the previous anonymous router / waitlist flow. It is not the active auth contract.

## Current auth direction

Do not roll back to the older Clerk client-id based approach. The current direction is Clerk authorization with the unique Supabase UUID claim (`supabase_uuid`) provided through the Clerk Supabase JWT template, then enforced through Supabase RLS.

The intended long-term route pattern is:

- Browser obtains Clerk session.
- Server routes that need user-scoped Supabase access call `createUserClient()`.
- Supabase sees the authenticated user's UUID through the Clerk/Supabase JWT integration.
- User-owned rows are inserted or read under RLS, instead of trusting client-submitted ownership fields.

## Legacy paths kept in Git history

Use `git show aec0233:<path>` to recover any of these files exactly as they existed before cleanup:

- `app/router/page.tsx`
- `app/router/classify/page.tsx`
- `app/router/questions/page.tsx`
- `app/router/results/page.tsx`
- `app/router/tracker/page.tsx`
- `app/router/path-a2/page.tsx`
- `app/router/path-e/page.tsx`
- `app/api/router/session/route.ts`
- `app/api/router/classify/route.ts`
- `app/api/router/questions/route.ts`
- `app/api/router/assess/route.ts`
- `lib/router-session.ts`
- `app/app/case/new/page.tsx`
- `app/waitlist/page.tsx`
- `app/api/waitlist/join/route.ts`

## Why this is archived

The refactor plan's Slice 5 contract is to move first authenticated case creation through `/api/cases/bootstrap`, then render the state-machine dashboard flow. The legacy router and waitlist paths were useful for the earlier prototype, but they should not be treated as the source of truth for the Clerk/Supabase UUID ownership model.

