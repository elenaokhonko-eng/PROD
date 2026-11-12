-- Model-call metering (cost-controls spec §5 B6, approved by Elena 8 Nov 2026).
--
-- One row per model call from the web app, the worker or an Edge Function, including failures: tokens, latency,
-- outcome and an estimated cost. No prompt or response text is stored. Service role only: neither signed-in users nor
-- anonymous callers can read or write it. Case and user links are cleared (not cascaded) when a case or profile is
-- deleted, so spend history survives without pointing at a person.

CREATE TABLE public.model_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL CHECK (environment IN ('production', 'staging', 'development', 'test')),
  caller text NOT NULL CHECK (caller IN ('web', 'worker', 'edge', 'script')),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 64),
  provider text NOT NULL CHECK (provider IN ('openai', 'gemini')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms integer CHECK (latency_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'retry', 'fallback', 'refused', 'error', 'blocked')),
  http_status integer,
  estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_id uuid
);

CREATE INDEX model_usage_created_idx ON public.model_usage (created_at);
CREATE INDEX model_usage_case_idx ON public.model_usage (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX model_usage_user_idx ON public.model_usage (user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX model_usage_purpose_idx ON public.model_usage (purpose, created_at);

ALTER TABLE public.model_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.model_usage TO service_role;

-- Estimated spend since midnight Singapore time, for the daily circuit breaker (§5 B4) in every runtime.
CREATE OR REPLACE FUNCTION public.model_usage_spend_today(p_environment text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(estimated_cost_usd), 0)
  FROM public.model_usage
  WHERE environment = p_environment
    AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore');
$$;

REVOKE ALL ON FUNCTION public.model_usage_spend_today(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.model_usage_spend_today(text) TO service_role;
