-- Staging safety net: clean up rows that reference profile IDs that no longer exist.
-- This unblocks the stricter Pattern C ownership + FK rewrite migration that follows.
--
-- In production these rows should not exist; each statement is scoped to orphaned
-- references only.

BEGIN;

-- Drop case ownership for cases whose owner no longer exists, and delete dependent
-- rows that require an owner. This avoids Pattern C preflight failures.
WITH orphan_cases AS (
  SELECT c.id
  FROM public.cases c
  WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
    )
)
DELETE FROM public.jobs j
USING orphan_cases oc
WHERE j.case_id = oc.id;

WITH orphan_cases AS (
  SELECT c.id
  FROM public.cases c
  WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
    )
)
DELETE FROM public.escalation_waitlist ew
USING orphan_cases oc
WHERE ew.case_id = oc.id;

WITH orphan_cases AS (
  SELECT c.id
  FROM public.cases c
  WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
    )
)
DELETE FROM public.case_purchases cp
USING orphan_cases oc
WHERE cp.case_id = oc.id;

WITH orphan_cases AS (
  SELECT c.id
  FROM public.cases c
  WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
    )
)
DELETE FROM public.case_consultations cc
USING orphan_cases oc
WHERE cc.case_id = oc.id;

WITH orphan_cases AS (
  SELECT c.id
  FROM public.cases c
  WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
    )
)
DELETE FROM public.consultation_recordings cr
USING orphan_cases oc
WHERE cr.case_id = oc.id;

-- Evidence requires a valid (non-null) user_id; delete orphaned rows.
DELETE FROM public.evidence e
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = e.user_id
);

-- Remove orphaned collaborator rows, and null out orphaned inviters.
DELETE FROM public.case_collaborators cc
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = cc.user_id
);

UPDATE public.case_collaborators cc
SET inviter_user_id = NULL
WHERE cc.inviter_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = cc.inviter_user_id
  );

-- Null out optional references that will be protected by Pattern C FKs.
UPDATE public.payments pay
SET user_id = NULL
WHERE pay.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = pay.user_id
  );

UPDATE public.analytics_events ae
SET user_id = NULL
WHERE ae.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = ae.user_id
  );

DELETE FROM public.consent_logs cl
WHERE cl.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = cl.user_id
  );

UPDATE public.referrals r
SET referrer_user_id = NULL
WHERE r.referrer_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = r.referrer_user_id
  );

UPDATE public.referrals r
SET referred_user_id = NULL
WHERE r.referred_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = r.referred_user_id
  );

UPDATE public.router_sessions rs
SET converted_to_user_id = NULL
WHERE rs.converted_to_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = rs.converted_to_user_id
  );

UPDATE public.reports r
SET user_id = NULL
WHERE r.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = r.user_id
  );

-- Finally, clear orphaned case ownership.
UPDATE public.cases c
SET user_id = NULL
WHERE c.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = c.user_id
  );

COMMIT;

