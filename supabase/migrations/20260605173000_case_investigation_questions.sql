-- Tier-2 FIDReC: investigation questions persistence (schema only).
-- Scope: questions derived from assertions, findings, and links.

CREATE TABLE public.case_investigation_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  source_assertion_id uuid REFERENCES public.case_bank_assertions (id) ON DELETE SET NULL,
  source_finding_id uuid REFERENCES public.case_findings (id) ON DELETE SET NULL,
  source_link_id uuid REFERENCES public.case_assertion_finding_links (id) ON DELETE SET NULL,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'particulars',
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  evidence_requested jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text,
  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_investigation_questions_question_type CHECK (
    question_type = ANY (
      ARRAY[
        'particulars'::text,
        'evidence_request'::text,
        'chronology_gap'::text,
        'authentication_gap'::text,
        'containment_gap'::text,
        'contradiction'::text,
        'human_review'::text
      ]
    )
  ),
  CONSTRAINT chk_case_investigation_questions_priority CHECK (
    priority = ANY (
      ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]
    )
  ),
  CONSTRAINT chk_case_investigation_questions_status CHECK (
    status = ANY (
      ARRAY['open'::text, 'answered'::text, 'dismissed'::text]
    )
  ),
  CONSTRAINT chk_case_investigation_questions_evidence_requested_array CHECK (jsonb_typeof(evidence_requested) = 'array')
);

ALTER TABLE public.case_investigation_questions OWNER TO postgres;

CREATE INDEX ix_case_investigation_questions_case_id
  ON public.case_investigation_questions USING btree (case_id);

CREATE INDEX ix_case_investigation_questions_status
  ON public.case_investigation_questions USING btree (status);

CREATE INDEX ix_case_investigation_questions_priority
  ON public.case_investigation_questions USING btree (priority);

CREATE INDEX ix_case_investigation_questions_source_assertion_id
  ON public.case_investigation_questions USING btree (source_assertion_id);

CREATE INDEX ix_case_investigation_questions_source_finding_id
  ON public.case_investigation_questions USING btree (source_finding_id);

CREATE INDEX ix_case_investigation_questions_source_link_id
  ON public.case_investigation_questions USING btree (source_link_id);

CREATE OR REPLACE TRIGGER trg_case_investigation_questions_set_updated_at
BEFORE UPDATE ON public.case_investigation_questions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
