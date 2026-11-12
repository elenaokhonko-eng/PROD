# Production canary

Cutover gate 7. `.github/workflows/production-canary.yml` runs `tests/e2e/canary/free-evaluation-canary.spec.ts`
against production: a new account submits a fixed synthetic story, confirms the facts and gets the free evaluation,
within these budgets, then everything it created is deleted.

| Step | Budget |
|---|---|
| Account to case | 3 min |
| Facts ready to confirm | 4 min |
| Free evaluation after Confirm | 3 min |
| Whole journey | 15 min |

It is **inert** until switched on at cutover (brief B), with Elena's approval.

## Switching it on

In GitHub, create the environment `production-canary` with:

- secrets: `CANARY_CLERK_SECRET_KEY` (production Clerk `sk_live`), `CANARY_SUPABASE_SERVICE_ROLE_KEY` (production),
  `CANARY_SMTP_PASS` (the info@ app password);
- variables: `CANARY_BASE_URL` (`https://guidebuoyai.sg`), `CANARY_SUPABASE_URL`, `CANARY_SMTP_HOST`
  (`smtp.gmail.com`), `CANARY_SMTP_USER` (`info@guidebuoyai.sg`), `CANARY_ALERT_EMAIL`.

Then set the repository variables `CANARY_HOURLY_UNTIL` (cutover date + 7 days, `YYYY-MM-DD`) and
`CANARY_ENABLED=true`. Run it once by hand (Actions → Production canary → Run workflow) and check it passes.

## What it leaves behind

Nothing in the database or storage: it deletes its files, case (which cascades), unlinked `analytics_events` and
`edge_request_nonces` rows, profile and Clerk user, following `privacy-case-deletion.md`. If a run dies before
cleanup, the account is recognisable: email `guidebuoy-canary+<timestamp>@guidebuoyai.sg` and Clerk public metadata
`canary: true`. Usage figures exclude emails starting `guidebuoy-canary+`. Each run creates one Clerk user, which
counts towards Clerk's monthly active users (about 170 in the hourly week, then about 30 a month).

## When it fails

The run fails (GitHub notifies) and `CANARY_ALERT_EMAIL` gets an email with the run link. Open the run log: it
names the step and its time. To pause it, set `CANARY_ENABLED` to `false`.
