-- Slice 8D: consultation_consents (immutable events) + current-state view
--
-- Draft only — do not apply until explicit approval.
-- One row = one consent event. Never UPDATE prior rows.

CREATE TABLE IF NOT EXISTS public.consultation_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL
    REFERENCES public.case_consultations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),

  consent_type text NOT NULL CHECK (consent_type IN (
    'consultation_terms',
    'recording',
    'transcription',
    'ai_summarisation',
    'case_record_insertion'
  )),

  decision text NOT NULL CHECK (decision IN (
    'granted',
    'declined',
    'withdrawn'
  )),

  notice_version text NOT NULL,
  notice_text_hash text NOT NULL,

  method text NOT NULL CHECK (method IN (
    'web_checkbox',
    'web_clickwrap',
    'verbal',
    'written',
    'other'
  )),

  consented_at timestamptz,
  withdrawn_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  verbal_confirmed boolean NOT NULL DEFAULT false,
  verbal_confirmed_by_profile_id uuid REFERENCES public.profiles(id),
  actor_profile_id uuid REFERENCES public.profiles(id),

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT consultation_consents_decision_timestamps CHECK (
    (decision = 'granted' AND consented_at IS NOT NULL)
    OR (decision = 'declined')
    OR (decision = 'withdrawn' AND withdrawn_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.consultation_consents IS
  'Immutable consent events for consultations. Current state is resolved by consultation_consent_current (latest per consultation_id, consent_type).';

CREATE INDEX IF NOT EXISTS consultation_consents_consultation_type_recorded_idx
  ON public.consultation_consents (consultation_id, consent_type, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS consultation_consents_case_id_idx
  ON public.consultation_consents (case_id);

ALTER TABLE public.consultation_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultation_consents_select_own ON public.consultation_consents;
CREATE POLICY consultation_consents_select_own
  ON public.consultation_consents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = consultation_consents.case_id
        AND c.user_id = public.current_app_user_id()
    )
  );

-- Claimant SELECT of own consent history; writes via service-role INSERT only.
REVOKE ALL ON TABLE public.consultation_consents FROM PUBLIC;
REVOKE ALL ON TABLE public.consultation_consents FROM anon;
REVOKE ALL ON TABLE public.consultation_consents FROM authenticated;
GRANT SELECT ON TABLE public.consultation_consents TO authenticated;
GRANT SELECT, INSERT ON TABLE public.consultation_consents TO service_role;

-- Reject UPDATE/DELETE for everyone (append-only).
CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % not allowed', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_append_only_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_consultation_consents_append_only ON public.consultation_consents;
CREATE TRIGGER trg_consultation_consents_append_only
  BEFORE UPDATE OR DELETE ON public.consultation_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_append_only_mutation();

-- Current state: latest event per (consultation_id, consent_type).
-- Deterministic tie-break: recorded_at DESC, id DESC.
-- security_invoker: caller RLS applies on underlying table (PG15+).
CREATE OR REPLACE VIEW public.consultation_consent_current
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (cc.consultation_id, cc.consent_type)
  cc.id,
  cc.consultation_id,
  cc.case_id,
  cc.user_id,
  cc.consent_type,
  cc.decision,
  cc.notice_version,
  cc.notice_text_hash,
  cc.method,
  cc.consented_at,
  cc.withdrawn_at,
  cc.recorded_at,
  cc.verbal_confirmed,
  cc.verbal_confirmed_by_profile_id,
  cc.actor_profile_id,
  cc.metadata
FROM public.consultation_consents cc
ORDER BY cc.consultation_id, cc.consent_type, cc.recorded_at DESC, cc.id DESC;

COMMENT ON VIEW public.consultation_consent_current IS
  'Latest consent event per (consultation_id, consent_type). security_invoker so case-scoped RLS on consultation_consents applies.';

REVOKE ALL ON public.consultation_consent_current FROM PUBLIC;
GRANT SELECT ON public.consultation_consent_current TO authenticated;
GRANT SELECT ON public.consultation_consent_current TO service_role;
