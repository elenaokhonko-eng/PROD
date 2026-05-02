-- Phase 2: row-level validation gaps (additive; JSON on case_validation_runs unchanged).
-- RLS/grants mirror public.case_validation_runs in 20260314055326_remote_schema.sql:
-- ENABLE ROW LEVEL SECURITY, no policies, GRANT ALL to anon / authenticated / service_role.

CREATE TABLE public.case_validation_gap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id uuid NOT NULL REFERENCES public.case_validation_runs (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  extract_run_id uuid REFERENCES public.case_extract_runs (id) ON DELETE SET NULL,
  field_key text NOT NULL,
  field_label text,
  gap_type text NOT NULL DEFAULT 'missing_required_field',
  severity text NOT NULL DEFAULT 'required',
  question_text text NOT NULL,
  help_text text,
  expected_answer_type text,
  answer_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'run_validation_v1',
  sort_order integer NOT NULL DEFAULT 0,
  raw_gap jsonb,
  raw_question jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Allows multiple rows per field (e.g. several questions); pair (field_key, sort_order) must be unique per run.
  CONSTRAINT uq_case_validation_gap_items_run_field_sort UNIQUE (validation_run_id, field_key, sort_order),
  CONSTRAINT chk_cv_gap_field_key_nonblank CHECK (btrim(field_key) <> ''),
  CONSTRAINT chk_cv_gap_question_text_nonblank CHECK (btrim(question_text) <> ''),
  CONSTRAINT chk_cv_gap_answer_options_array CHECK (jsonb_typeof(answer_options) = 'array'),
  CONSTRAINT chk_cv_gap_severity CHECK (
    severity = ANY (ARRAY['required'::text, 'recommended'::text, 'optional'::text])
  ),
  CONSTRAINT chk_cv_gap_gap_type CHECK (
    gap_type = ANY (
      ARRAY[
        'missing_required_field'::text,
        'ambiguous_field'::text,
        'contradiction'::text,
        'needs_confirmation'::text,
        'evidence_gap'::text
      ]
    )
  ),
  CONSTRAINT chk_cv_gap_expected_answer_type CHECK (
    expected_answer_type IS NULL
    OR expected_answer_type = ANY (
      ARRAY[
        'text'::text,
        'date'::text,
        'datetime'::text,
        'money'::text,
        'number'::text,
        'boolean'::text,
        'single_choice'::text,
        'multi_choice'::text,
        'file_upload'::text,
        'textarea'::text
      ]
    )
  )
);

ALTER TABLE public.case_validation_gap_items OWNER TO postgres;

COMMENT ON TABLE public.case_validation_gap_items IS 'Structured, user-facing validation gaps linked to a case_validation_runs row; complements JSON on parent without replacing it. Multiple rows may share field_key per run when sort_order differs (several questions for one field).';

CREATE INDEX ix_case_validation_gap_items_validation_run_id
  ON public.case_validation_gap_items USING btree (validation_run_id);

CREATE INDEX ix_case_validation_gap_items_case_id
  ON public.case_validation_gap_items USING btree (case_id);

CREATE INDEX ix_case_validation_gap_items_extract_run_id
  ON public.case_validation_gap_items USING btree (extract_run_id);

CREATE INDEX ix_case_validation_gap_items_case_created
  ON public.case_validation_gap_items USING btree (case_id, created_at DESC);

CREATE INDEX ix_case_validation_gap_items_run_sort
  ON public.case_validation_gap_items USING btree (validation_run_id, sort_order);

ALTER TABLE public.case_validation_gap_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.case_validation_gap_items TO anon;
GRANT ALL ON TABLE public.case_validation_gap_items TO authenticated;
GRANT ALL ON TABLE public.case_validation_gap_items TO service_role;

CREATE OR REPLACE VIEW public.v_case_validation_gap_items AS
SELECT
  id,
  validation_run_id,
  case_id,
  extract_run_id,
  field_key,
  field_label,
  gap_type,
  severity,
  question_text,
  help_text,
  expected_answer_type,
  answer_options,
  source,
  sort_order,
  created_at
FROM public.case_validation_gap_items;

ALTER VIEW public.v_case_validation_gap_items OWNER TO postgres;

GRANT ALL ON TABLE public.v_case_validation_gap_items TO anon;
GRANT ALL ON TABLE public.v_case_validation_gap_items TO authenticated;
GRANT ALL ON TABLE public.v_case_validation_gap_items TO service_role;
