# Cutover checklist

Planned for Thursday 12 November 2026, on Elena's approval (moved from 10 and then 11 November). Brief B
(production setup and the smoke test on `prod-check.guidebuoyai.sg`) is complete before this starts. Names only; no values.

Done on 11 November, before the smoke test: G3b re-check 2 passed (R-02, R-05); the 39 migrations applied to PROD
after Gate P2a (empty ledger, plan identical to the repo, pinned hashes); reference tables copied; private `evidence`
bucket; Edge secrets and functions; production web and worker created on Render (plan `standard`, auto-deploy off,
`PAID_STAGES_ENABLED=false`, no Stripe values), all AI models answering with the production keys. G5 (merge and tag)
waits for full CI, which GitHub's runners could not finish that night.

## Before moving the domains

- [ ] Smoke test on `https://prod-check.guidebuoyai.sg` passed: fresh account, full free evaluation, one Report a
      problem, one waitlist click, model calls visible on `/analytics`. Two emails arrive in real inboxes: Clerk
      Production's sign-up code, and the problem report at info@ (the app's own SMTP). The waitlist click sends no
      email: it shows "Thank you. We'll email …" and saves the address. This is the only check of real email delivery,
      because staging keeps no SMTP test inbox (Elena, 10 Nov).
- [x] `LEGAL_EFFECTIVE_DATE=2026-11-12` on the production web service, and the Terms and Privacy pages show it
      (checked on the onrender.com address, 11 Nov). Change it if cutover moves to another day.
- [ ] G5: full CI green on the release commit, merged to `main` with a merge commit, tagged; the production services
      switched to `main` and the tagged commit deployed.
- [ ] Clerk Production: `supabase` JWT template (claims as in `docs/runbooks/slice-0-auth-reconciliation.md` 1.2),
      Supabase PROD Third-Party Auth with the Clerk Production issuer, allowed origins and redirect URLs including
      `prod-check.guidebuoyai.sg` for the smoke test, and the `user.created` webhook with its signing secret set as
      `CLERK_WEBHOOK_SIGNING_SECRET` on the production web service.
- [ ] Supabase PROD Auth: email sign-ups off (Clerk is the only sign-in).
- [ ] Google key `prod-render-server` restricted to the production Render outbound IPs; `prod-edge-functions` stays
      API-restricted only.
- [ ] Admin role seeded for Elena's production account after her first production sign-in (migration procedure 4).
- [ ] Clerk Production legal consent is on (Elena confirmed, 10 Nov) with `https://guidebuoyai.sg/terms` and
      `https://guidebuoyai.sg/privacy`; disposable-domain and sub-address blocking are on.
- [ ] Console limits in place (Elena): OpenAI hard limit, Supabase spend cap, SPF/DKIM/DMARC, Cloudflare SSL mode
      and rate-limit rule, 2-step verification. Google PROD budget, quotas and key API restrictions are done (11 Nov);
      raise the Gemini quotas to 60 requests and 250,000 input tokens a minute before launch. Cost alerts go to
      `ADMIN_EMAIL` on the worker unless `COST_ALERT_EMAIL` is set.

## Move

- [ ] Move `guidebuoyai.sg` and `www.guidebuoyai.sg` from the maintenance service to the production web service;
      certificates issued; `www` redirects to the apex.
- [ ] Set `HARBOR_ALLOWED_HOSTS=guidebuoyai.sg,www.guidebuoyai.sg` on the production web service and redeploy.
      `pnpm check:env-set` passes for production.
- [ ] `https://<production service>.onrender.com/` answers 404; `/api/health/release` still answers there.
- [ ] `/api/health/client-address` (worker secret) on `guidebuoyai.sg` resolves the caller's own address, not a
      Cloudflare edge.
- [ ] Security headers present on `https://guidebuoyai.sg/` (HSTS, X-Frame-Options, CSP frame-ancestors, nosniff,
      Referrer-Policy, Permissions-Policy); session cookies are Secure.

## Remove the smoke-test name

- [ ] Delete the `prod-check.guidebuoyai.sg` DNS record in Cloudflare.
- [ ] Remove `prod-check.guidebuoyai.sg` from Clerk Production's allowed origins.
- [ ] Remove the custom domain `prod-check.guidebuoyai.sg` from the production Render web service.
- [ ] `HARBOR_ALLOWED_HOSTS` no longer lists it.

## After

- [ ] Arm the production canary (`CANARY_ENABLED`, `docs/runbooks/production-canary.md`).
- [ ] Rotate production secrets as the cost-controls spec says and record the date.
- [ ] Keep the maintenance service suspended, not deleted, for 7 days as the rollback.
- [ ] Week one: daily look at the cost page, the fallback rate and alerts; the 429 alert in particular.
- [ ] First change after launch: one floating WhatsApp button on every page, public, sign-in and case pages
      (Elena monitors the number, 10 Nov). It replaces the footer link and changes the Slice 7 rule and its test; the
      public visual baselines are re-rendered by CI and approved by Elena.
- [ ] Week one: voice and pasted story text add to each other and never replace; one date format in the evaluation
      summary; log refused case starts so a failure like R-02 shows in the logs; a time limit on every CI job (a stalled
      browser install ran 52 minutes on 11 Nov); `check:env-set` fails when the Render and Edge Gemini keys are the
      same key; the worker's SMTP settings in `render.yaml`; indexes for the 11 unindexed foreign keys the advisor lists.
- [ ] Week two: a Gemini-to-OpenAI fallback on 429 and 5xx for document reading and transcription, recorded in
      `model_usage`; Gemini as the primary model where it is cheaper; Gemini embeddings (re-embedding the regulatory
      clauses, and matching the vector dimension in a migration); a separate Google project for document processing
      with its own key, budget and quotas, alongside the Vertex move.
