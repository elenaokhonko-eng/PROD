-- Tier-2 FIDReC persistence foundation (minimal schema only).
-- Scope: bank assertions, neutral findings, and assertion-finding links.

CREATE TABLE public.case_bank_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.case_documents (id) ON DELETE SET NULL,
  assertion_text text NOT NULL,
  assertion_type text NOT NULL,
  bank_conclusion_supported text,
  particulars_needed jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_needed jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_bank_assertions_assertion_type CHECK (
    assertion_type = ANY (
      ARRAY[
        'factual'::text,
        'technical'::text,
        'procedural'::text,
        'liability'::text
      ]
    )
  ),
  CONSTRAINT chk_case_bank_assertions_particulars_needed_array CHECK (jsonb_typeof(particulars_needed) = 'array'),
  CONSTRAINT chk_case_bank_assertions_evidence_needed_array CHECK (jsonb_typeof(evidence_needed) = 'array')
);

ALTER TABLE public.case_bank_assertions OWNER TO postgres;

CREATE TABLE public.case_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  finding_text text NOT NULL,
  finding_type text NOT NULL,
  supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL DEFAULT 'medium',
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  human_review_required boolean NOT NULL DEFAULT true,
  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_findings_finding_type CHECK (
    finding_type = ANY (
      ARRAY[
        'core_claim'::text,
        'chronology'::text,
        'authentication'::text,
        'transaction_pattern'::text,
        'notification'::text,
        'customer_behaviour'::text,
        'fi_behaviour'::text,
        'containment'::text
      ]
    )
  ),
  CONSTRAINT chk_case_findings_confidence CHECK (
    confidence = ANY (
      ARRAY['low'::text, 'medium'::text, 'high'::text]
    )
  ),
  CONSTRAINT chk_case_findings_supporting_evidence_array CHECK (jsonb_typeof(supporting_evidence) = 'array'),
  CONSTRAINT chk_case_findings_missing_information_array CHECK (jsonb_typeof(missing_information) = 'array')
);

ALTER TABLE public.case_findings OWNER TO postgres;

CREATE TABLE public.case_assertion_finding_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  bank_assertion_id uuid NOT NULL REFERENCES public.case_bank_assertions (id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES public.case_findings (id) ON DELETE CASCADE,
  relationship text NOT NULL,
  explanation text,
  confidence text NOT NULL DEFAULT 'medium',
  next_question text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_assertion_finding_links_relationship CHECK (
    relationship = ANY (
      ARRAY[
        'supports_bank_assertion'::text,
        'rebuts_bank_assertion'::text,
        'partially_rebuts'::text,
        'requires_particulars'::text,
        'irrelevant'::text
      ]
    )
  ),
  CONSTRAINT chk_case_assertion_finding_links_confidence CHECK (
    confidence = ANY (
      ARRAY['low'::text, 'medium'::text, 'high'::text]
    )
  )
);

ALTER TABLE public.case_assertion_finding_links OWNER TO postgres;

CREATE INDEX ix_case_bank_assertions_case_id
  ON public.case_bank_assertions USING btree (case_id);

CREATE INDEX ix_case_findings_case_id
  ON public.case_findings USING btree (case_id);

CREATE INDEX ix_case_assertion_finding_links_case_id
  ON public.case_assertion_finding_links USING btree (case_id);

CREATE INDEX ix_case_assertion_finding_links_bank_assertion_id
  ON public.case_assertion_finding_links USING btree (bank_assertion_id);

CREATE INDEX ix_case_assertion_finding_links_finding_id
  ON public.case_assertion_finding_links USING btree (finding_id);

CREATE OR REPLACE TRIGGER trg_case_bank_assertions_set_updated_at
BEFORE UPDATE ON public.case_bank_assertions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_case_findings_set_updated_at
BEFORE UPDATE ON public.case_findings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_case_assertion_finding_links_set_updated_at
BEFORE UPDATE ON public.case_assertion_finding_links
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
