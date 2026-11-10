# Cutover checklist

Planned for Wednesday 11 November 2026, morning, on Elena's approval (moved from Tuesday 10 November). Brief B
(production setup and the smoke test on `prod-check.guidebuoyai.sg`) is complete before this starts. Names only; no values.

## Before moving the domains

- [ ] Smoke test on `https://prod-check.guidebuoyai.sg` passed: fresh account, full free evaluation, one Report a
      problem, one waitlist click, model calls visible on `/analytics`. Two emails arrive in real inboxes: Clerk
      Production's sign-up code, and the problem report at info@ (the app's own SMTP). The waitlist click sends no
      email: it shows "Thank you. We'll email …" and saves the address. This is the only check of real email delivery,
      because staging keeps no SMTP test inbox (Elena, 10 Nov).
- [ ] `LEGAL_EFFECTIVE_DATE=2026-11-11` on the production web service (or the actual cutover day), and the Terms and
      Privacy pages show it.
- [ ] Clerk Production legal consent is on (Elena confirmed, 10 Nov) with `https://guidebuoyai.sg/terms` and
      `https://guidebuoyai.sg/privacy`; disposable-domain and sub-address blocking are on.
- [ ] Console limits in place (Elena): OpenAI hard limit, Google budget and Gemini quotas, Google key restrictions,
      Supabase spend cap, `COST_ALERT_EMAIL` on the worker.

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
