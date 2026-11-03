# Staging walkthrough (release 2026-11, gate G3b)

Staging app: https://guidebuoy-staging-web.onrender.com
Supabase project: `yqqkkftfddxuxmpxwbcj` (SQL Editor for the checks below; they only read).
Stripe: **test mode**. Card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
Clerk: **Development** instance. For email sign-up use an address ending `+clerk_test@example.com`; the
verification code is always `424242` and no real email is sent.

Tick each box. If a step fails, note the time and what you saw in the defect log at the end; don't retry more than
once. Each check query takes your sign-up email: replace `you+clerk_test@example.com`.

## 1. Sign-up and identity
- [ ] **Email sign-up.** `/sign-up` with `you+clerk_test@example.com`, code `424242`. You land in `/app`.
- [ ] **Google sign-up** with a Google account you control. You land in `/app`.
- [ ] For each new user, exactly one profile and one entitlement row exist, and Clerk has the mapping:
  ```sql
  select p.id, p.clerk_id, p.email, (select count(*) from user_entitlements e where e.user_id = p.id) as entitlements
  from profiles p where p.email = 'you+clerk_test@example.com';
  ```
  Expect one row, `entitlements = 1`. In Clerk → Development → Users → that user → Metadata, `public.supabase_uuid`
  equals `p.id`.

## 2. Sessions and access
- [ ] Sign out, then open `/app`: you're sent to sign-in. `/app/signup` opens without signing in.
- [ ] Sign back in: you return to `/app`.
- [ ] Leave a tab idle for 10+ minutes, then click around `/app`: it keeps working (session refreshes) or asks you
      to sign in again; it never shows another user's data.

## 3. Public router to case
- [ ] Signed out, run the router at `/router` to a **path A** result, then again to a **path B** result.
- [ ] On the result page, choose to continue; sign in or sign up when asked. A case opens in `/app`.
- [ ] Refresh the page during "creating your case" (or press Back and continue again). Still only one case:
  ```sql
  select c.id, c.created_at, (select count(*) from router_sessions r where r.converted_to_case_id = c.id) as sessions
  from cases c join profiles p on p.id = c.user_id
  where p.email = 'you+clerk_test@example.com' order by c.created_at desc;
  ```
  Expect one new case per router run.

## 4. Evidence
- [ ] On the case, upload a PDF or image (any non-personal test document).
- [ ] Within a few minutes the document shows as processed.
  ```sql
  select d.filename, d.processing_status, j.job_type, j.status as job_status
  from case_documents d left join jobs j on j.case_id = d.case_id and j.job_type = 'evidence_document_processing'
  join cases c on c.id = d.case_id join profiles p on p.id = c.user_id
  where p.email = 'you+clerk_test@example.com' order by d.upload_date desc limit 5;
  ```
  Expect your document and a job that reaches `succeeded`.

## 5. Payments: S$18 self-serve report
- [ ] On the case, start the S$18 report checkout, then **cancel** on the Stripe page. Back on the case, start it
      again: the same reservation is reused.
- [ ] Pay with `4242 4242 4242 4242`. You return to the case with a success message.
- [ ] Within a few minutes the report is visible on the case.
  ```sql
  select cp.product_code, cp.payment_status, cp.amount, cp.created_at
  from case_purchases cp join profiles p on p.id = cp.user_id
  where p.email = 'you+clerk_test@example.com' order by cp.created_at;
  select event_type, processing_status, created_at from payment_webhook_events order by created_at desc limit 5;
  select job_type, status, completed_at from jobs where job_type = 'post_payment_report_generation'
  order by created_at desc limit 3;
  ```
  Expect one `self_serve_report` purchase (the cancel did not create a second), `paid`; a
  `checkout.session.completed` event `processed`; a report job `succeeded`.
- [ ] **Refund it** in Stripe (test mode → Payments → that payment → Refund). The refund appears:
  ```sql
  select event_type, processing_status from payment_webhook_events where event_type = 'charge.refunded'
  order by created_at desc limit 1;
  ```

## 6. Payments: S$188 Tier-2 pack
- [ ] On a case with the S$18 report, buy the S$188 pack with the test card.
- [ ] The Tier-2 sections unlock on the case.
  ```sql
  select cp.product_code, cp.payment_status from case_purchases cp join profiles p on p.id = cp.user_id
  where p.email = 'you+clerk_test@example.com' and cp.product_code = 'escalation_pack';
  ```

## 7. Email
- [ ] Mailtrap → Email Testing → the staging inbox shows the emails from steps 1 to 6 (where the app sends them),
      with working links back to the staging site.

## 8. Privacy, invitations, public pages
- [ ] `/app/settings` → **Export my data**: a download starts and contains only your own data.
- [ ] `/app/settings` → **Delete my account** (use a throwaway sign-up, not the one you are testing with):
  ```sql
  select status, requested_at from privacy_deletion_requests order by requested_at desc limit 1;
  ```
- [ ] From a case, **invite a collaborator** (a second `+clerk_test@example.com` address). Open the invite in a
      private window, sign up, accept: the collaborator sees that case only.
- [ ] Signed out, check `/`, `/pricing`, `/how-it-works`, `/privacy`, `/terms`: content and links look right, and
      the footer WhatsApp and email links work.

## 9. Imported golden data
The imported real case belongs only to **user-golden**, a manual-walkthrough identity. CI never signs in as it and its
session is never saved. It has no password and its address can't receive mail, so the only way in is a one-time
sign-in link from the agent (valid 5 minutes). Use a private window and sign out when done.

- [ ] Sign in as **user-golden** with the one-time link. Two cases are listed: the imported real case (REA-002) and a
      test case holding copies of its documents. Open the real case: its documents and Tier-2 analysis (findings,
      themes, evidence requests) display.
  ```sql
  select p.email, count(c.id) as cases from profiles p left join cases c on c.user_id = p.id
  where p.email like 'harbor.release.%@example.com' group by p.email order by 1;
  ```
  Expect `golden` 2, `user-b`'s address 30, the others 0.
- [ ] Sign in as **user-a** and then **user-b** (one-time links): user-a has no imported cases; user-b has 30
      synthetic and test cases. Neither sees the real case.

## Defect log
| # | Step | Time | What happened | Severity |
|---|------|------|---------------|----------|
|   |      |      |               |          |

Sign-off (G3b): ____________________  Date: __________
