# Security notes

A record of security findings and decisions for the GuideBuoy AI release. Names, routes and counts only; no secret
values, no case data.

## Found and fixed before launch (9 November 2026)

Both found during the pre-cutover hardening review, on the release branch, before the production service existed. The
production site was a maintenance page throughout, so neither route was ever reachable on production. The staging
mail logs were not reviewed for misuse; staging test traffic goes to a sink and a Mailtrap sandbox, not to real inboxes.

| # | Finding | Risk | Fix (commit `87fe804`) |
|---|---|---|---|
| S1 | `POST /api/email/welcome` had no sign-in check and no rate limit. Anyone could make the server send a GuideBuoy-branded email, with a name they chose, to any address, from our sending domain. Nothing in the app called it. | Phishing and spam sent as GuideBuoy, aimed at scam victims; damage to the domain's sending reputation. | Route removed. A test fails if it returns. |
| S2 | `POST /api/email/send` required a signed-in account (free to create) but accepted any recipient, any subject, any HTML body and any `from` address, ten a minute per address. It existed only as an SMTP self-test for CI. | The same phishing risk, one sign-up away. | Mail now goes only to the configured test and admin recipients (`HARBOR_SMTP_TEST_RECIPIENT`, `HARBOR_PREVIEW_EMAIL_SINK`, `ADMIN_EMAIL`), always from `EMAIL_FROM`, with a fixed `[GuideBuoy SMTP test]` subject prefix; anything else gets 403. Tested in `tests/contracts/route-auth.test.ts`. |

Also fixed in the same review: the internal contact-request email inserted user-typed fields into its HTML unescaped
(now escaped, tested in `tests/contracts/safety-notice.test.ts`).

## Pre-cutover hardening (9 November 2026)

| Item | State |
|---|---|
| Next.js 14.2.16 → 14.2.35 (middleware bypass GHSA-f82v-jwr5-mffw); `@clerk/nextjs` 7.0.1 → 7.9.21 (GHSA-vqx2-fgx2-5wq9, GHSA-w24r-5266-9c3c) | Done |
| Every API route and signed-in page checks access itself, not only in middleware | Done, enforced by `tests/contracts/route-auth.test.ts` |
| Remaining Next 14 advisories fixed only in 15.5 | Image-optimizer RCEs unreachable (`images.unoptimized`, pinned by test); Windows-only RCE not applicable (Linux); DoS and SSRF items on the week-one Next 15 upgrade |
| Production answers only on `HARBOR_ALLOWED_HOSTS` (health checks excepted) | Done; set at cutover |
| Per-IP limits key on `CF-Connecting-IP` only from Cloudflare's published ranges | Done; measured on staging |
| Pre-sign-in model calls: anonymous sub-cap of 25% of the daily cap; 8 an hour and 20 a day per address | Done |
| Uploads: PDF, PNG, JPEG only (signature-checked), 15 MB, 30 PDF pages; buckets private, no file links issued | Done |
| Clerk webhook fails closed on a missing or wrong secret | Done, tested |
| Clerk Production: disposable-domain and sub-address blocking | On (9 Nov, via API) |
| Clerk Production: legal consent with Terms and Privacy URLs; "I am 18 or over" label | Label in the app; the switch is Elena's dashboard step |
| Security headers: HSTS, X-Frame-Options, frame-ancestors, nosniff, referrer and permissions policies | Done |
| "GuideBuoy will never ask for your bank login, PIN or OTP." in footers and every email | Done |
| Gitleaks over the full history | 2 findings, both false positives (a made-up test key, an example ID in a doc) |
| Admin role seeded for the founder's production account only | Step 4 of `docs/runbooks/prod-migration-procedure.md` |

## Week one after launch

1. Next.js 15 upgrade (clears the remaining Next 14 advisories).
2. Full content-security policy, including scripts, tested against Clerk.
3. Cloudflare Turnstile on the pre-sign-in model calls (triage classify, triage questions, voice transcription).
4. Session inactivity timeout in Clerk (about an hour).
5. Error tracking with personal data scrubbed.
6. A backup restore test: production backup onto staging.
7. Regulatory corpus fixes 2–6 (`docs/release/regulatory-corpus-audit-2026-11-08.md`).
