-- Tier-2 FIDReC: case themes and theme links (organisational grouping only).

CREATE TABLE public.case_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  theme_type text NOT NULL,
  theme_title text NOT NULL,
  theme_summary text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_themes_theme_type CHECK (
    theme_type = ANY (
      ARRAY[
        'authentication'::text,
        'token_registration'::text,
        'transaction_pattern'::text,
        'fraud_detection'::text,
        'containment'::text,
        'customer_reporting'::text,
        'bank_investigation_quality'::text,
        'evidence_disclosure'::text,
        'customer_negligence'::text,
        'other'::text
      ]
    )
  ),
  CONSTRAINT chk_case_themes_priority CHECK (
    priority = ANY (
      ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]
    )
  ),
  CONSTRAINT chk_case_themes_status CHECK (
    status = ANY (
      ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text]
    )
  )
);

ALTER TABLE public.case_themes OWNER TO postgres;

CREATE TABLE public.case_theme_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  theme_id uuid NOT NULL REFERENCES public.case_themes (id) ON DELETE CASCADE,
  bank_assertion_id uuid REFERENCES public.case_bank_assertions (id) ON DELETE SET NULL,
  finding_id uuid REFERENCES public.case_findings (id) ON DELETE SET NULL,
  assertion_finding_link_id uuid REFERENCES public.case_assertion_finding_links (id) ON DELETE SET NULL,
  investigation_question_id uuid REFERENCES public.case_investigation_questions (id) ON DELETE SET NULL,
  evidence_request_id uuid REFERENCES public.case_evidence_requests (id) ON DELETE SET NULL,
  link_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.case_theme_links OWNER TO postgres;

CREATE INDEX ix_case_themes_case_id
  ON public.case_themes USING btree (case_id);

CREATE INDEX ix_case_themes_theme_type
  ON public.case_themes USING btree (theme_type);

CREATE INDEX ix_case_themes_priority
  ON public.case_themes USING btree (priority);

CREATE INDEX ix_case_themes_status
  ON public.case_themes USING btree (status);

CREATE INDEX ix_case_theme_links_case_id
  ON public.case_theme_links USING btree (case_id);

CREATE INDEX ix_case_theme_links_theme_id
  ON public.case_theme_links USING btree (theme_id);

CREATE INDEX ix_case_theme_links_bank_assertion_id
  ON public.case_theme_links USING btree (bank_assertion_id);

CREATE INDEX ix_case_theme_links_finding_id
  ON public.case_theme_links USING btree (finding_id);

CREATE INDEX ix_case_theme_links_assertion_finding_link_id
  ON public.case_theme_links USING btree (assertion_finding_link_id);

CREATE INDEX ix_case_theme_links_investigation_question_id
  ON public.case_theme_links USING btree (investigation_question_id);

CREATE INDEX ix_case_theme_links_evidence_request_id
  ON public.case_theme_links USING btree (evidence_request_id);

CREATE OR REPLACE TRIGGER trg_case_themes_set_updated_at
BEFORE UPDATE ON public.case_themes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
