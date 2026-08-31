ALTER TABLE public.router_sessions
  ADD COLUMN creation_intent uuid;

CREATE UNIQUE INDEX router_sessions_creation_intent_key
  ON public.router_sessions (creation_intent)
  WHERE creation_intent IS NOT NULL;
