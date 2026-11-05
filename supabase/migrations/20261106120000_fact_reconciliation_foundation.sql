-- Fact reconciliation foundation (design: docs/release/fact-reconciliation-design.md, section 3).
--
-- 1) case_story_revisions and case_response_revisions keep the history of what the user wrote. Triggers fill them,
--    so bootstrap_case_v1 and the responses route are unchanged. Existing stories and answers are backfilled.
-- 2) case_fact_reconcile_runs, case_fact_candidates, case_fact_findings, case_fact_snapshots and
--    case_fact_confirmation_events hold extracted candidate facts, the findings the user resolves, the frozen facts
--    each stage was generated from, and the audit trail.
-- 3) reports and case_narratives record the snapshot they were generated from.
--
-- Every new table: RLS on, case-scoped SELECT for authenticated (app_case_permission 'view'), no client writes,
-- service_role writes. Snapshots and audit events cannot be updated; rows still delete with their case.

-- ---------------------------------------------------------------------------------------------------------------
-- User-authored history
-- ---------------------------------------------------------------------------------------------------------------

CREATE TABLE public.case_story_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  story_text text NOT NULL CHECK (length(btrim(story_text)) > 0 AND length(story_text) <= 20000),
  origin text NOT NULL CHECK (origin IN ('onboarding', 'user_edit')),
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, revision)
);

COMMENT ON TABLE public.case_story_revisions IS
  'The user''s own story, one row per version. Never GuideBuoy-generated text. Revision 1 comes from cases.primary_narrative.';

CREATE TABLE public.case_response_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  response_value text,
  response_type text,
  origin text NOT NULL CHECK (origin IN ('intake', 'follow_up', 'journey')),
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_response_revisions_case_key_idx
  ON public.case_response_revisions (case_id, question_key, created_at DESC);

COMMENT ON TABLE public.case_response_revisions IS
  'Append-only history of case_responses (which keeps only the latest value per question).';

CREATE OR REPLACE FUNCTION public.record_case_story_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.primary_narrative IS NULL OR btrim(NEW.primary_narrative) = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.primary_narrative IS NOT DISTINCT FROM OLD.primary_narrative THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.case_story_revisions (case_id, revision, story_text, origin, created_by_profile_id)
  SELECT
    NEW.id,
    coalesce(max(r.revision), 0) + 1,
    left(NEW.primary_narrative, 20000),
    CASE WHEN TG_OP = 'INSERT' THEN 'onboarding' ELSE 'user_edit' END,
    NEW.user_id
  FROM public.case_story_revisions r
  WHERE r.case_id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_record_story_revision
  AFTER INSERT OR UPDATE OF primary_narrative ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.record_case_story_revision();

CREATE OR REPLACE FUNCTION public.record_case_response_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.case_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.response_value IS NOT DISTINCT FROM OLD.response_value
     AND NEW.response_type IS NOT DISTINCT FROM OLD.response_type THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.case_response_revisions (
    case_id, question_key, response_value, response_type, origin, created_by_profile_id
  ) VALUES (
    NEW.case_id,
    NEW.question_key,
    NEW.response_value,
    NEW.response_type,
    CASE
      WHEN NEW.question_key LIKE 'journey\_%' THEN 'journey'
      WHEN NEW.question_key IN (
        'institution_name', 'account_details', 'incident_summary', 'financial_impact',
        'desired_outcome', 'previous_contact', 'contact_details'
      ) THEN 'intake'
      ELSE 'follow_up'
    END,
    public.current_app_user_id()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER case_responses_record_revision
  AFTER INSERT OR UPDATE OF response_value, response_type ON public.case_responses
  FOR EACH ROW EXECUTE FUNCTION public.record_case_response_revision();

-- Backfill: revision 1 from each existing story, and the current answers as their first revision.
INSERT INTO public.case_story_revisions (case_id, revision, story_text, origin, created_by_profile_id, created_at)
SELECT c.id, 1, left(c.primary_narrative, 20000), 'onboarding', c.user_id, coalesce(c.created_at, now())
FROM public.cases c
WHERE c.primary_narrative IS NOT NULL AND btrim(c.primary_narrative) <> '';

INSERT INTO public.case_response_revisions (
  case_id, question_key, response_value, response_type, origin, created_by_profile_id, created_at
)
SELECT
  r.case_id,
  r.question_key,
  r.response_value,
  r.response_type,
  CASE
    WHEN r.question_key LIKE 'journey\_%' THEN 'journey'
    WHEN r.question_key IN (
      'institution_name', 'account_details', 'incident_summary', 'financial_impact',
      'desired_outcome', 'previous_contact', 'contact_details'
    ) THEN 'intake'
    ELSE 'follow_up'
  END,
  c.user_id,
  coalesce(r.created_at, now())
FROM public.case_responses r
JOIN public.cases c ON c.id = r.case_id;

-- ---------------------------------------------------------------------------------------------------------------
-- Fact model
-- ---------------------------------------------------------------------------------------------------------------

CREATE TABLE public.case_fact_reconcile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  story_revision integer,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_code text,
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX case_fact_reconcile_runs_case_idx ON public.case_fact_reconcile_runs (case_id, created_at DESC);

CREATE TABLE public.case_fact_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.case_fact_reconcile_runs(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  value jsonb NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('story', 'answer', 'document')),
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_fact_candidates_run_idx ON public.case_fact_candidates (run_id, fact_key);
CREATE INDEX case_fact_candidates_case_idx ON public.case_fact_candidates (case_id);

CREATE TABLE public.case_fact_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.case_fact_reconcile_runs(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  finding_type text NOT NULL CHECK (finding_type IN ('conflict', 'unsupported', 'missing', 'agreed')),
  "values" jsonb NOT NULL DEFAULT '[]'::jsonb,
  values_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'not_sure', 'acknowledged')),
  resolution jsonb,
  resolved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

CREATE INDEX case_fact_findings_current_idx
  ON public.case_fact_findings (case_id, fact_key)
  WHERE invalidated_at IS NULL;

CREATE TABLE public.case_fact_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('free', 'bank', 'fidrec')),
  facts jsonb NOT NULL,
  hash text NOT NULL,
  run_id uuid REFERENCES public.case_fact_reconcile_runs(id) ON DELETE SET NULL,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_fact_snapshots_case_stage_idx ON public.case_fact_snapshots (case_id, stage, created_at DESC);

CREATE TABLE public.case_fact_confirmation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES public.case_fact_findings(id) ON DELETE SET NULL,
  snapshot_id uuid REFERENCES public.case_fact_snapshots(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('resolved', 'not_sure', 'acknowledged', 'reopened', 'snapshot_created')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_fact_confirmation_events_case_idx ON public.case_fact_confirmation_events (case_id, created_at);

-- Snapshots and audit events are immutable. DELETE stays possible so case deletion cascades.
CREATE OR REPLACE FUNCTION public.forbid_fact_record_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER case_fact_snapshots_immutable
  BEFORE UPDATE ON public.case_fact_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.forbid_fact_record_update();

CREATE TRIGGER case_fact_confirmation_events_immutable
  BEFORE UPDATE ON public.case_fact_confirmation_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_fact_record_update();

-- Generated outputs record the snapshot they used.
ALTER TABLE public.reports
  ADD COLUMN fact_snapshot_id uuid REFERENCES public.case_fact_snapshots(id) ON DELETE SET NULL;
ALTER TABLE public.case_narratives
  ADD COLUMN fact_snapshot_id uuid REFERENCES public.case_fact_snapshots(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Access: case-scoped read for the signed-in owner or collaborator, writes through service_role only.
-- ---------------------------------------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'case_story_revisions',
    'case_response_revisions',
    'case_fact_reconcile_runs',
    'case_fact_candidates',
    'case_fact_findings',
    'case_fact_snapshots',
    'case_fact_confirmation_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_case_permission(case_id, %L))',
      t || '_select_authorized', t, 'view'
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.record_case_story_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_case_response_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forbid_fact_record_update() FROM PUBLIC, anon, authenticated;
