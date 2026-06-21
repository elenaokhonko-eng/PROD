-- Tier-2 FIDReC: evidence requests persistence (schema only).
-- Scope: practical upload/request guidance derived from investigation questions.

CREATE TABLE public.case_evidence_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases (id) ON DELETE CASCADE,
  source_question_id uuid REFERENCES public.case_investigation_questions (id) ON DELETE SET NULL,
  source_assertion_id uuid REFERENCES public.case_bank_assertions (id) ON DELETE SET NULL,
  source_finding_id uuid REFERENCES public.case_findings (id) ON DELETE SET NULL,
  source_link_id uuid REFERENCES public.case_assertion_finding_links (id) ON DELETE SET NULL,
  request_text text NOT NULL,
  request_reason text,
  evidence_category text NOT NULL DEFAULT 'other',
  requested_from text NOT NULL DEFAULT 'customer',
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  suggested_file_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  example_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_case_evidence_requests_evidence_category CHECK (
    evidence_category = ANY (
      ARRAY[
        'bank_communication'::text,
        'hotline_record'::text,
        'transaction_record'::text,
        'notification_record'::text,
        'authentication_record'::text,
        'device_or_ip_record'::text,
        'police_or_statutory'::text,
        'customer_context'::text,
        'bank_particulars'::text,
        'other'::text
      ]
    )
  ),
  CONSTRAINT chk_case_evidence_requests_requested_from CHECK (
    requested_from = ANY (
      ARRAY['customer'::text, 'bank'::text, 'third_party'::text, 'unknown'::text]
    )
  ),
  CONSTRAINT chk_case_evidence_requests_priority CHECK (
    priority = ANY (
      ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]
    )
  ),
  CONSTRAINT chk_case_evidence_requests_status CHECK (
    status = ANY (
      ARRAY['open'::text, 'provided'::text, 'unavailable'::text, 'dismissed'::text]
    )
  ),
  CONSTRAINT chk_case_evidence_requests_suggested_file_types_array CHECK (jsonb_typeof(suggested_file_types) = 'array'),
  CONSTRAINT chk_case_evidence_requests_example_documents_array CHECK (jsonb_typeof(example_documents) = 'array')
);

ALTER TABLE public.case_evidence_requests OWNER TO postgres;

CREATE INDEX ix_case_evidence_requests_case_id
  ON public.case_evidence_requests USING btree (case_id);

CREATE INDEX ix_case_evidence_requests_source_question_id
  ON public.case_evidence_requests USING btree (source_question_id);

CREATE INDEX ix_case_evidence_requests_evidence_category
  ON public.case_evidence_requests USING btree (evidence_category);

CREATE INDEX ix_case_evidence_requests_requested_from
  ON public.case_evidence_requests USING btree (requested_from);

CREATE INDEX ix_case_evidence_requests_priority
  ON public.case_evidence_requests USING btree (priority);

CREATE INDEX ix_case_evidence_requests_status
  ON public.case_evidence_requests USING btree (status);

CREATE OR REPLACE TRIGGER trg_case_evidence_requests_set_updated_at
BEFORE UPDATE ON public.case_evidence_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
