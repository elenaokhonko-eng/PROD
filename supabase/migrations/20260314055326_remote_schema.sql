


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."user_role" AS ENUM (
    'victim',
    'helper',
    'lead_victim',
    'defendant',
    'regulator'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_entitlement"("p_case_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_case_user_id uuid;

  v_user_plan text;
  v_user_features jsonb;

  v_case_plan text;
  v_case_features jsonb;
  v_case_expires_at timestamptz;

  v_plan text := 'free';
  v_features jsonb := '{}'::jsonb;

  v_now timestamptz := now();
begin
  -- Get user_id from case
  select c.user_id
    into v_case_user_id
  from public.cases c
  where c.id = p_case_id;

  if v_case_user_id is null then
    raise exception 'Case not found';
  end if;

  -- Load user entitlements (if any)
  select ue.plan, ue.features
    into v_user_plan, v_user_features
  from public.user_entitlements ue
  where ue.user_id = v_case_user_id;

  if v_user_plan is not null then
    v_plan := v_user_plan;
    v_features := coalesce(v_user_features, '{}'::jsonb);
  end if;

  -- Load case override (if any)
  select ce.plan, ce.features, ce.expires_at
    into v_case_plan, v_case_features, v_case_expires_at
  from public.case_entitlements ce
  where ce.case_id = p_case_id;

  if v_case_plan is not null then
    if v_case_expires_at is null or v_case_expires_at > v_now then
      v_plan := v_case_plan;
      v_features := v_features || coalesce(v_case_features, '{}'::jsonb);
    end if;
  end if;

  -- Derive feature gates if not explicitly set

  v_features := jsonb_set(
    v_features, '{allow_evidence}',
    to_jsonb(coalesce((v_features->>'allow_evidence')::boolean,
      v_plan in ('self_serve_report','escalation_pack'))),
    true
  );

  v_features := jsonb_set(
    v_features, '{allow_regulatory_retrieval}',
    to_jsonb(coalesce((v_features->>'allow_regulatory_retrieval')::boolean,
      v_plan in ('self_serve_report','escalation_pack'))),
    true
  );

  v_features := jsonb_set(
    v_features, '{allow_regulatory_citations}',
    to_jsonb(coalesce((v_features->>'allow_regulatory_citations')::boolean,
      v_plan in ('self_serve_report','escalation_pack'))),
    true
  );

  v_features := jsonb_set(
    v_features, '{allow_self_serve_report}',
    to_jsonb(coalesce((v_features->>'allow_self_serve_report')::boolean,
      v_plan in ('self_serve_report','escalation_pack'))),
    true
  );

  v_features := jsonb_set(
    v_features, '{allow_escalation_pack}',
    to_jsonb(coalesce((v_features->>'allow_escalation_pack')::boolean,
      v_plan = 'escalation_pack')),
    true
  );

  -- Tier 2 only
  v_features := jsonb_set(
    v_features, '{allow_decisioning}',
    to_jsonb(coalesce((v_features->>'allow_decisioning')::boolean,
      v_plan = 'escalation_pack')),
    true
  );

  return jsonb_build_object(
    'case_id', p_case_id,
    'user_id', v_case_user_id,
    'plan', v_plan,
    'features', v_features
  );
end;
$$;


ALTER FUNCTION "public"."get_effective_entitlement"("p_case_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_decision_run"() RETURNS "void"
    LANGUAGE "sql"
    AS $_$create or replace function public.get_latest_decision_run(p_case_id uuid)
returns public.case_decision_runs
language sql
stable
as $$
  select *
  from public.case_decision_runs
  where case_id = p_case_id
  order by created_at desc
  limit 1;
$$;$_$;


ALTER FUNCTION "public"."get_latest_decision_run"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role_text TEXT;
  first_name_text TEXT;
  last_name_text TEXT;
  full_name_text TEXT;
  phone_number_text TEXT;
  email_notifications_text TEXT;
  sms_notifications_text TEXT;
  email_notifications_value BOOLEAN := TRUE;
  sms_notifications_value BOOLEAN := FALSE;
BEGIN
  user_role_text := COALESCE(NEW.raw_user_meta_data ->> 'role', 'victim');

  first_name_text := NULLIF(NEW.raw_user_meta_data ->> 'first_name', '');
  last_name_text := NULLIF(NEW.raw_user_meta_data ->> 'last_name', '');
  full_name_text := NULLIF(NEW.raw_user_meta_data ->> 'full_name', '');
  phone_number_text := NULLIF(NEW.raw_user_meta_data ->> 'phone_number', '');

  IF full_name_text IS NULL THEN
    full_name_text := NULLIF(TRIM(COALESCE(first_name_text, '') || ' ' || COALESCE(last_name_text, '')), '');
  END IF;

  email_notifications_text := NEW.raw_user_meta_data ->> 'email_notifications';
  sms_notifications_text := NEW.raw_user_meta_data ->> 'sms_notifications';

  IF email_notifications_text IS NOT NULL THEN
    email_notifications_value := CASE
      WHEN LOWER(email_notifications_text) IN ('true', 't', '1', 'yes', 'y') THEN TRUE
      WHEN LOWER(email_notifications_text) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
      ELSE TRUE
    END;
  END IF;

  IF sms_notifications_text IS NOT NULL THEN
    sms_notifications_value := CASE
      WHEN LOWER(sms_notifications_text) IN ('true', 't', '1', 'yes', 'y') THEN TRUE
      WHEN LOWER(sms_notifications_text) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
      ELSE FALSE
    END;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    first_name,
    last_name,
    role,
    phone_number,
    full_name,
    email_notifications,
    sms_notifications
  )
  VALUES (
    NEW.id,
    NEW.email,
    first_name_text,
    last_name_text,
    CASE
      WHEN user_role_text IN ('victim','helper','lead_victim','defendant') THEN user_role_text::user_role
      ELSE 'victim'::user_role
    END,
    phone_number_text,
    full_name_text,
    email_notifications_value,
    sms_notifications_value
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
        role = EXCLUDED.role,
        phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        email_notifications = EXCLUDED.email_notifications,
        sms_notifications = EXCLUDED.sms_notifications,
        updated_at = NOW();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_entitlement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.user_entitlements (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_entitlement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_feature (feature_key text)"() RETURNS "void"
    LANGUAGE "sql"
    AS $_$create or replace function public.has_feature(feature_key text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (public.user_entitlements.features ->> feature_key)::boolean,
    false
  )
  from public.user_entitlements
  where user_id = auth.uid();
$$;$_$;


ALTER FUNCTION "public"."has_feature (feature_key text)"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_public_decisions"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision DEFAULT 0.15) RETURNS TABLE("id" "uuid", "summary" "text", "issues" "text", "outcome" "text", "outcome_favours" "text", "similarity" real)
    LANGUAGE "sql" STABLE
    AS $$
  select
    pd.id,
    pd.summary,
    pd.issues,
    pd.outcome,
    pd.outcome_favours,
    (1 - (pd.embedding <=> query_embedding))::real as similarity
  from public.public_decisions pd
  where pd.embedding is not null
    and (1 - (pd.embedding <=> query_embedding)) >= similarity_threshold
  order by pd.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_public_decisions"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_public_decisions_threshold"("query_embedding" "public"."vector", "match_count" integer DEFAULT 5, "similarity_threshold" double precision DEFAULT 0.75) RETURNS TABLE("id" "uuid", "source_system" "text", "forum_name" "text", "case_number" "text", "outcome" "text", "title" "text", "summary" "text", "decision_at" timestamp with time zone, "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    pd.id,
    pd.source_system,
    pd.forum_name,
    pd.case_number,
    pd.outcome,
    pd.title,
    pd.summary,
    pd.decision_at,
    (1 - (pd.embedding <=> query_embedding))::float as similarity
  from public_decisions pd
  where pd.embedding is not null
    and (1 - (pd.embedding <=> query_embedding)) >= similarity_threshold
  order by pd.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_public_decisions_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "clause_ref" "text", "source_ref" "text", "clause_type" "text", "text_content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$select
    rc.id,
    rc.clause_ref,
    rc.source_ref,
    rc.clause_type,
    rc.text_content,
    (1 - (rc.embedding <-> query_embedding))::float as similarity
  from public.regulatory_clauses rc
  where rc.embedding is not null
  order by rc.embedding <-> query_embedding
  limit match_count;$$;


ALTER FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision DEFAULT 0.15) RETURNS TABLE("id" "uuid", "document_id" "uuid", "clause_ref" "text", "clause_type" "text", "title" "text", "text_content" "text", "source_ref" "text", "created_at" timestamp with time zone, "similarity" real)
    LANGUAGE "sql" STABLE
    AS $$
  select
    rc.id,
    rc.document_id,
    rc.clause_ref,
    rc.clause_type,
    rc.title,
    rc.text_content,
    rc.source_ref,
    rc.created_at,
    (1 - (rc.embedding <=> query_embedding))::real as similarity
  from public.regulatory_clauses rc
  where rc.embedding is not null
    and (1 - (rc.embedding <=> query_embedding)) >= similarity_threshold
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_regulatory_clauses_threshold"("query_embedding" "public"."vector", "match_count" integer DEFAULT 10, "similarity_threshold" double precision DEFAULT 0.7) RETURNS TABLE("id" "uuid", "document_id" "uuid", "clause_ref" "text", "clause_type" "text", "title" "text", "text_content" "text", "source_ref" "text", "created_at" timestamp with time zone, "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    rc.id,
    rc.document_id,
    rc.clause_ref,
    rc.clause_type,
    rc.title,
    rc.text_content,
    rc.source_ref,
    rc.created_at,
    (1 - (rc.embedding <=> query_embedding))::float as similarity
  from regulatory_clauses rc
  where rc.embedding is not null
    and (1 - (rc.embedding <=> query_embedding)) >= similarity_threshold
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_regulatory_clauses_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_validation_v1"("p_extract_run_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$declare
  v_case_id uuid;
  v_intake_id uuid;
  v_extract jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_questions jsonb := '[]'::jsonb;
  v_status text := 'valid';
  v_validation_id uuid;
begin
  select case_id, intake_id, extract_json
  into v_case_id, v_intake_id, v_extract
  from public.case_extract_runs
  where id = p_extract_run_id;

  -- Пример проверки: incident_date
  if (v_extract->>'incident_date') is null then
    v_missing := v_missing || jsonb_build_object(
      'field','incident_date',
      'reason','Not found in extracted fields',
      'severity','required',
      'suggested_question','What date did the incident occur?'
    );
    v_questions := v_questions || jsonb_build_object(
      'id','q_incident_date',
      'question','What date did the incident occur?',
      'field','incident_date',
      'answer_type','date',
      'required',true,
      'options',null
    );
  end if;

  -- Пример проверки: reported_loss_amount
  if (v_extract->'reported_loss'->>'amount') is null then
    v_missing := v_missing || jsonb_build_object(
      'field','reported_loss.amount',
      'reason','Loss amount missing',
      'severity','required',
      'suggested_question','What is the total amount lost?'
    );
    v_questions := v_questions || jsonb_build_object(
      'id','q_loss_amount',
      'question','What is the total amount lost?',
      'field','reported_loss.amount',
      'answer_type','money',
      'required',true,
      'options',null
    );
  end if;

  if jsonb_array_length(v_missing) > 0 or jsonb_array_length(v_questions) > 0 then
    v_status := 'needs_user';
  end if;

  insert into public.case_validation_runs(
    case_id, extract_run_id, intake_id,
    missing_fields, ambiguities, questions_to_user,
    status, source, schema_version, is_valid
  )
  values (
    v_case_id, p_extract_run_id, v_intake_id,
    v_missing, '[]'::jsonb, v_questions,
    v_status, 'rules', 'v1', true
  )
  returning id into v_validation_id;

  return v_validation_id;
end;$$;


ALTER FUNCTION "public"."run_validation_v1"("p_extract_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_case_intake_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.version is null then
    select coalesce(max(version), 0) + 1
      into new.version
    from public.case_intake
    where case_id = new.case_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_case_intake_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_case_document_from_storage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
declare
  v_case_id uuid;
  v_filename text;
  v_case_id_text text;
begin
  -- Only act on your evidence bucket
  if new.bucket_id <> 'case_evidence' then
    return new;
  end if;

  -- Expect: cases/<case_id>/documents/<filename>
  v_case_id_text := split_part(new.name, '/', 2);

  -- If the path doesn't match expected pattern, skip quietly
  if split_part(new.name, '/', 1) <> 'cases' or v_case_id_text is null or v_case_id_text = '' then
    return new;
  end if;

  -- Parse UUID (will throw if invalid; so guard with regex)
  if v_case_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_case_id := v_case_id_text::uuid;
  else
    return new;
  end if;

  -- Filename = last segment
  v_filename := split_part(
    new.name,
    '/',
    array_length(string_to_array(new.name, '/'), 1)
  );

  insert into public.case_documents (
      case_id,
      filename,
      original_filename,
      file_size,
      mime_type,
      upload_date,
      storage_provider,
      storage_bucket,
      storage_path,
      is_processed,
      processing_status,
      processing_error
  )
  values (
      v_case_id,
      v_filename,
      v_filename,
      null,
      null,
      now(),
      'supabase',
      new.bucket_id,
      new.name,
      false,
      'UPLOADED',
      null
  )
  on conflict (storage_bucket, storage_path)
  do update set
      case_id = excluded.case_id,
      filename = excluded.filename,
      original_filename = excluded.original_filename,
      upload_date = coalesce(public.case_documents.upload_date, excluded.upload_date);

  return new;
end;
$_$;


ALTER FUNCTION "public"."sync_case_document_from_storage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_report_selfserve_v1"() RETURNS "void"
    LANGUAGE "sql"
    AS $_$create or replace function public.upsert_report_selfserve_v1(
  p_case_id uuid,
  p_inputs_hash text,
  p_source_decision_run_id uuid,
  p_report_json jsonb
)
returns public.reports
language plpgsql
security definer
as $$
declare
  v_row public.reports;
begin
  -- Try insert
  insert into public.reports (
    id,
    user_id,
    case_id,
    report_type,
    status,
    inputs_hash,
    source_decision_run_id,
    report_json,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    auth.uid(),
    p_case_id,
    'self_serve_v1',
    'ready',
    p_inputs_hash,
    p_source_decision_run_id,
    p_report_json,
    now(),
    now()
  )
  on conflict (user_id, case_id, report_type, inputs_hash)
  do update set
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;$_$;


ALTER FUNCTION "public"."upsert_report_selfserve_v1"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "session_id" "text",
    "event_name" "text" NOT NULL,
    "event_data" "jsonb",
    "page_url" "text",
    "user_agent" "text",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anonymized_training_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "original_case_id" "uuid",
    "anonymized_narrative" "text",
    "dispute_category" "text",
    "outcome_type" "text",
    "anonymization_method" "text",
    "anonymized_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."anonymized_training_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_collaborators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "inviter_user_id" "uuid",
    "invited_email" "text",
    "role" "text" DEFAULT 'viewer'::"text",
    "permissions" "text"[] DEFAULT ARRAY['read'::"text"],
    "status" "text" DEFAULT 'pending'::"text",
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "last_accessed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "case_collaborators_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'editor'::"text", 'owner'::"text"]))),
    CONSTRAINT "case_collaborators_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'declined'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."case_collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_decision_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "decision_json" "jsonb" NOT NULL,
    "eligibility_status" "text" NOT NULL,
    "strength_score_value" integer,
    "model_name" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "extract_run_id" "uuid",
    "validation_run_id" "uuid",
    CONSTRAINT "case_decision_runs_decision_version_v1" CHECK ((("decision_json" ->> 'decision_version'::"text") = 'case_decision_v1'::"text")),
    CONSTRAINT "case_decision_runs_required_keys_v1" CHECK (((("decision_json" ->> 'decision_version'::"text") <> 'case_decision_v1'::"text") OR (("decision_json" ? 'eligibility'::"text") AND ("decision_json" ? 'references'::"text") AND (("decision_json" -> 'eligibility'::"text") ? 'score'::"text") AND (("decision_json" -> 'eligibility'::"text") ? 'status'::"text"))))
);


ALTER TABLE "public"."case_decision_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_decision_runs" IS 'Store every decision, score, eligibility, and rationale - never overwrite history.';



CREATE TABLE IF NOT EXISTS "public"."case_document_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "chunk_text" "text" NOT NULL,
    "page_start" integer,
    "page_end" integer,
    "char_start" integer,
    "char_end" integer,
    "section_title" "text",
    "chunk_type" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_document_chunks" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_document_chunks" IS 'Supports retrieval, citation-level grounding, or multi-document reasoning at scale.';



CREATE TABLE IF NOT EXISTS "public"."case_document_extractions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "content_id" "uuid",
    "extraction_type" "text" NOT NULL,
    "schema_version" "text" NOT NULL,
    "extracted_json" "jsonb" NOT NULL,
    "extracted_text" "text",
    "confidence" numeric,
    "validation_status" "text" DEFAULT 'unreviewed'::"text",
    "validation_notes" "text",
    "citations" "jsonb",
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_document_extractions" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_document_extractions" IS 'Stores structured facts extracted by an LLM from a specific document, with provenance, confidence, and citations — so extracted knowledge is deterministic, reusable, and auditable.';



CREATE TABLE IF NOT EXISTS "public"."case_document_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "content_id" "uuid",
    "declared_document_type" "text",
    "predicted_document_type" "text",
    "confidence" numeric,
    "decision" "text" NOT NULL,
    "reason" "text",
    "evidence_spans" "jsonb",
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "verified_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_document_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_document_verifications" IS 'Stores the type verification / classification result for each uploaded document. Ensures that what the user uploaded and labelled (e.g., “police report”) is actually that kind of document, with confidence scoring and explainable evidence cues.';



CREATE TABLE IF NOT EXISTS "public"."case_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid",
    "filename" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "file_size" integer,
    "mime_type" "text",
    "document_type" "text",
    "exhibit_label" "text",
    "upload_date" timestamp with time zone DEFAULT "now"(),
    "file_url" "text",
    "is_processed" boolean DEFAULT false,
    "sha256" "text",
    "processing_status" "text" DEFAULT 'uploaded'::"text",
    "processing_error" "text",
    "verified_document_type" "text",
    "verification_status" "text",
    "verification_confidence" numeric,
    "content_latest_id" "uuid",
    "storage_provider" "text" DEFAULT 'supabase'::"text",
    "storage_bucket" "text",
    "storage_path" "text"
);


ALTER TABLE "public"."case_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_documents" IS 'Canonical register of all evidence files uploaded for a case (PDFs, images, emails, logs). One row per uploaded artefact. Stores storage pointers and user-declared document type so the system can parse, verify, and assemble an evidence pack.';



CREATE TABLE IF NOT EXISTS "public"."case_documents_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "pipeline_version" "text" NOT NULL,
    "parsed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "text_content" "text",
    "content_json" "jsonb",
    "language" "text",
    "page_count" integer,
    "parse_status" "text" DEFAULT 'success'::"text" NOT NULL,
    "parse_errors" "jsonb",
    "content_sha256" "text"
);


ALTER TABLE "public"."case_documents_content" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_documents_content" IS 'Stores the parsed/converted content extracted from an uploaded document (full text + optional structured blocks) produced by Gemini SOTA (or any parser). This is the “machine-readable” representation used for search, LLM reasoning, and downstream structured extraction.';



CREATE OR REPLACE VIEW "public"."case_documents_enriched" AS
 SELECT "e"."id" AS "extraction_id",
    "e"."case_id",
    "e"."document_id",
    "e"."content_id",
    "e"."extracted_text",
    "e"."extracted_json",
    "e"."confidence" AS "extraction_confidence",
    "e"."created_at" AS "extraction_created_at",
    "v"."declared_document_type",
    "v"."predicted_document_type",
    "v"."confidence" AS "verification_confidence",
    "v"."decision" AS "verification_decision",
    "v"."reason" AS "verification_reason",
    "v"."evidence_spans" AS "verification_spans",
    "v"."verified_at"
   FROM ("public"."case_document_extractions" "e"
     LEFT JOIN "public"."case_document_verifications" "v" ON ((("v"."document_id" = "e"."document_id") AND (NOT ("v"."content_id" IS DISTINCT FROM "e"."content_id")))));


ALTER VIEW "public"."case_documents_enriched" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_entitlements" (
    "case_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "purchased_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "source" "text",
    "purchase_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_entitlements_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'self_serve_report'::"text", 'escalation_pack'::"text"])))
);


ALTER TABLE "public"."case_entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "event_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text" NOT NULL,
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "text",
    "amount" numeric,
    "currency" "text",
    "reference" "text",
    "event_sequence" integer,
    "source" "text",
    "confidence" numeric
);


ALTER TABLE "public"."case_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_events" IS 'Canonical fact timeline for a case: small, atomic, time-ordered events that can be used deterministically.';



CREATE TABLE IF NOT EXISTS "public"."case_extract_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "extract_json" "jsonb" NOT NULL,
    "missing_fields" "jsonb",
    "model_name" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "intake_id" "uuid"
);


ALTER TABLE "public"."case_extract_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_extract_runs" IS 'Store what the model extracted, with which prompt/model/version, so we can:  debug hallucinations  / re-run Decide without re-parsing text / build training data later';



CREATE TABLE IF NOT EXISTS "public"."case_intake" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "narrative_text" "text",
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "intake_type" "text" DEFAULT 'initial'::"text",
    "version" integer DEFAULT 1,
    "answers_json" "jsonb",
    "language" "text" DEFAULT 'en'::"text",
    "timezone" "text" DEFAULT 'Asia/Singapore'::"text",
    "is_user_confirmed" boolean DEFAULT false,
    CONSTRAINT "case_intake_language_not_blank" CHECK ((("language" IS NULL) OR ("length"("btrim"("language")) > 0))),
    CONSTRAINT "case_intake_timezone_not_blank" CHECK ((("timezone" IS NULL) OR ("length"("btrim"("timezone")) > 0))),
    CONSTRAINT "case_intake_version_positive" CHECK ((("version" IS NULL) OR ("version" >= 1)))
);


ALTER TABLE "public"."case_intake" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_intake" IS 'Immutable journal of what the user said or submitted, across time.  It is the ground-truth input for the system, it captures iterations: initial story, follow-up answers, clarifications, edits.  It lets us reconstruct exactly what was known at the time of each AI run.  It enables the feedback loop: ask questions → user answers → new intake row.';



CREATE TABLE IF NOT EXISTS "public"."case_narratives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "narrative_type" "text" NOT NULL,
    "title" "text",
    "text_content" "text" NOT NULL,
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" integer,
    "intake_id" "uuid",
    "extract_run_id" "uuid",
    "decision_run_id" "uuid",
    "language" "text" DEFAULT 'en'::"text",
    "audience" "text"
);


ALTER TABLE "public"."case_narratives" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_narratives" IS 'Stores human- and AI-readable “versions” of the case story, distinct from raw intake and distinct from atomic facts.';



CREATE TABLE IF NOT EXISTS "public"."case_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid",
    "outcome_type" "text",
    "amount_recovered" numeric(12,2),
    "outcome_date" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "case_outcomes_outcome_type_check" CHECK (("outcome_type" = ANY (ARRAY['no_recovery'::"text", 'partial_recovery'::"text", 'full_recovery'::"text", 'partial_recovery_due_to_safeguard_failure'::"text"])))
);


ALTER TABLE "public"."case_outcomes" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_outcomes" IS 'Stores ground-truth outcomes for a case (what actually happened after escalation / dispute resolution), including recovery amount and date. This table is not used in the live decision loop; it exists for audit, reporting, and model learning/calibration.';



CREATE TABLE IF NOT EXISTS "public"."case_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid",
    "question_key" "text" NOT NULL,
    "response_value" "text",
    "response_type" "text" DEFAULT 'text'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "case_responses_response_type_check" CHECK (("response_type" = ANY (ARRAY['text'::"text", 'boolean'::"text", 'number'::"text", 'date'::"text", 'file'::"text"])))
);


ALTER TABLE "public"."case_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_validation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "extract_run_id" "uuid" NOT NULL,
    "intake_id" "uuid",
    "missing_fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ambiguities" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "questions_to_user" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "validation_summary" "text",
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "source" "text" DEFAULT 'model'::"text" NOT NULL,
    "model_name" "text",
    "prompt_version" "text",
    "schema_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "is_valid" boolean DEFAULT true NOT NULL,
    "raw_output" "jsonb",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_case_validation_runs_source" CHECK (("source" = ANY (ARRAY['model'::"text", 'rules'::"text", 'hybrid'::"text"]))),
    CONSTRAINT "chk_case_validation_runs_status" CHECK (("status" = ANY (ARRAY['created'::"text", 'valid'::"text", 'needs_user'::"text", 'invalid'::"text", 'error'::"text"]))),
    CONSTRAINT "chk_v_ambiguities_is_array" CHECK (("jsonb_typeof"("ambiguities") = 'array'::"text")),
    CONSTRAINT "chk_v_missing_is_array" CHECK (("jsonb_typeof"("missing_fields") = 'array'::"text")),
    CONSTRAINT "chk_v_questions_is_array" CHECK (("jsonb_typeof"("questions_to_user") = 'array'::"text"))
);


ALTER TABLE "public"."case_validation_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_validation_runs" IS 'This table stores versioned validation results for a case at a point in time.';



CREATE TABLE IF NOT EXISTS "public"."cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "claim_type" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "claim_amount" numeric(12,2),
    "institution_name" "text",
    "incident_date" "date",
    "case_summary" "text",
    "eligibility_status" "text",
    "strength_score" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "owner_user_id" "uuid",
    "creator_user_id" "uuid",
    "dispute_category" "text",
    "router_session_id" "text",
    "is_anonymous" boolean DEFAULT false,
    "data_retention_policy" "text" DEFAULT 'standard'::"text",
    "anonymization_requested" boolean DEFAULT false,
    "anonymization_completed_at" timestamp with time zone,
    "case_status" "text" DEFAULT 'DRAFT'::"text",
    "primary_narrative" "text",
    "case_key" "text",
    "claim_currency" "text" DEFAULT 'SGD'::"text",
    "jurisdiction" "text" DEFAULT 'SG'::"text",
    "strength_score_value" integer,
    "incident_datetime" timestamp with time zone,
    CONSTRAINT "cases_claim_type_check" CHECK (("claim_type" = ANY (ARRAY['phishing_scam'::"text", 'mis_sold_product'::"text", 'denied_insurance'::"text"]))),
    CONSTRAINT "cases_eligibility_status_check" CHECK (("eligibility_status" = ANY (ARRAY['eligible'::"text", 'out_of_scope'::"text", 'pending'::"text"]))),
    CONSTRAINT "cases_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'triage'::"text", 'intake'::"text", 'evidence'::"text", 'generation'::"text", 'filed'::"text", 'tracking'::"text", 'completed'::"text"]))),
    CONSTRAINT "cases_strength_score_check" CHECK (("strength_score" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."cases" IS 'Canonical container for a single victim case Stable identifier across all processing stages It currently has several legacy columns to be deprecated / changed to read-only.';



CREATE OR REPLACE VIEW "public"."complaints" AS
 SELECT "id",
    "user_id",
    "claim_type",
    "status",
    "claim_amount",
    "institution_name",
    "incident_date",
    "case_summary",
    "eligibility_status",
    "strength_score",
    "created_at",
    "updated_at",
    "owner_user_id",
    "creator_user_id",
    "dispute_category",
    "router_session_id",
    "is_anonymous",
    "data_retention_policy",
    "anonymization_requested",
    "anonymization_completed_at"
   FROM "public"."cases";


ALTER VIEW "public"."complaints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consent_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "consent_purposes" "text"[] NOT NULL,
    "policy_version" "text" DEFAULT '1.0'::"text",
    "consented_at" timestamp with time zone DEFAULT "now"(),
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."consent_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_sources_inbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_system" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "jurisdiction_code" "text" NOT NULL,
    "forum_name" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "discovered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "notes" "text",
    "source_url_raw" "text",
    "source_host" "text",
    "source_path" "text",
    "source_doc_id" "text"
);


ALTER TABLE "public"."decision_sources_inbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."decision_sources_inbox" IS 'It contains determinations URLs as we find them, and process them later (manual or automated) without losing track.';



CREATE TABLE IF NOT EXISTS "public"."evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "filename" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_size" bigint NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "report_id" "uuid"
);


ALTER TABLE "public"."evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "inviter_user_id" "uuid" NOT NULL,
    "invitee_email" "text" NOT NULL,
    "role" "public"."user_role" NOT NULL,
    "invitation_token" "text" NOT NULL,
    "invitation_message" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "accepted_by" "uuid",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."llm_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "task" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "input_snapshot" "jsonb" NOT NULL,
    "output" "jsonb",
    "model" "text",
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."llm_runs" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_complaint_status_counts" AS
 SELECT "count"(*) FILTER (WHERE ("status" = 'completed'::"text")) AS "completed",
    "count"(*) FILTER (WHERE ("status" <> 'completed'::"text")) AS "pending"
   FROM "public"."cases"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_complaint_status_counts" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_country_rollup" AS
 SELECT COALESCE(("event_data" ->> 'ip_country'::"text"), ("event_data" ->> 'country'::"text"), ("event_data" ->> 'country_code'::"text"), 'UNKNOWN'::"text") AS "country",
    "count"(*) AS "events"
   FROM "public"."analytics_events"
  GROUP BY COALESCE(("event_data" ->> 'ip_country'::"text"), ("event_data" ->> 'country'::"text"), ("event_data" ->> 'country_code'::"text"), 'UNKNOWN'::"text")
  ORDER BY ("count"(*)) DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_country_rollup" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_funnel_durations" AS
 WITH "first_events" AS (
         SELECT COALESCE("analytics_events"."session_id", ("analytics_events"."user_id")::"text") AS "key",
            "min"("analytics_events"."created_at") FILTER (WHERE ("analytics_events"."event_name" = 'story_submitted'::"text")) AS "story_submitted",
            "min"("analytics_events"."created_at") FILTER (WHERE ("analytics_events"."event_name" = 'signup_complete'::"text")) AS "signup_complete",
            "min"("analytics_events"."created_at") FILTER (WHERE ("analytics_events"."event_name" = 'documents_uploaded'::"text")) AS "documents_uploaded",
            "min"("analytics_events"."created_at") FILTER (WHERE ("analytics_events"."event_name" = 'report_generated'::"text")) AS "report_generated",
            "min"("analytics_events"."created_at") FILTER (WHERE ("analytics_events"."event_name" = 'report_downloaded'::"text")) AS "report_downloaded"
           FROM "public"."analytics_events"
          WHERE ("analytics_events"."event_name" = ANY (ARRAY['story_submitted'::"text", 'signup_complete'::"text", 'documents_uploaded'::"text", 'report_generated'::"text", 'report_downloaded'::"text"]))
          GROUP BY COALESCE("analytics_events"."session_id", ("analytics_events"."user_id")::"text")
        )
 SELECT "avg"((EXTRACT(epoch FROM ("signup_complete" - "story_submitted")) / 60.0)) AS "avg_story_to_signup_minutes",
    "avg"((EXTRACT(epoch FROM ("documents_uploaded" - "signup_complete")) / 60.0)) AS "avg_signup_to_docs_minutes",
    "avg"((EXTRACT(epoch FROM ("report_generated" - "documents_uploaded")) / 60.0)) AS "avg_docs_to_report_minutes",
    "avg"((EXTRACT(epoch FROM ("report_downloaded" - "report_generated")) / 60.0)) AS "avg_report_to_download_minutes"
   FROM "first_events"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_funnel_durations" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_pages_per_session" AS
 SELECT "session_id",
    "count"(*) FILTER (WHERE ("event_name" = 'page_view'::"text")) AS "page_views",
    "count"(*) AS "total_events",
    "min"("created_at") AS "first_event_at",
    "max"("created_at") AS "last_event_at"
   FROM "public"."analytics_events"
  GROUP BY "session_id"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_pages_per_session" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "case_id" "uuid",
    "status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "report_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "report_type" "text" DEFAULT 'self_serve_v1'::"text" NOT NULL,
    "source_decision_run_id" "uuid",
    "inputs_hash" "text",
    CONSTRAINT "reports_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'COMPLETED'::"text", 'EXPORTED'::"text", 'RESOLVED'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_report_status_counts" AS
 SELECT "count"(*) FILTER (WHERE ("status" = ANY (ARRAY['COMPLETED'::"text", 'EXPORTED'::"text", 'RESOLVED'::"text"]))) AS "completed",
    "count"(*) FILTER (WHERE ("status" <> ALL (ARRAY['COMPLETED'::"text", 'EXPORTED'::"text", 'RESOLVED'::"text"]))) AS "pending"
   FROM "public"."reports"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_report_status_counts" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_session_counts" AS
 SELECT ("date_trunc"('day'::"text", "created_at"))::"date" AS "day",
    "count"(DISTINCT "session_id") AS "unique_sessions",
    "count"(*) AS "total_events"
   FROM "public"."analytics_events"
  WHERE ("created_at" >= ("now"() - '365 days'::interval))
  GROUP BY (("date_trunc"('day'::"text", "created_at"))::"date")
  ORDER BY (("date_trunc"('day'::"text", "created_at"))::"date") DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_session_counts" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_session_counts_periods" AS
 WITH "base" AS (
         SELECT ("analytics_events"."created_at")::"date" AS "day",
            "analytics_events"."session_id"
           FROM "public"."analytics_events"
          WHERE ("analytics_events"."created_at" >= ("now"() - '365 days'::interval))
        ), "agg" AS (
         SELECT 'day'::"text" AS "granularity",
            "base"."day" AS "period_start",
            "count"(DISTINCT "base"."session_id") AS "unique_sessions",
            "count"(*) AS "total_events"
           FROM "base"
          GROUP BY 'day'::"text", "base"."day"
        UNION ALL
         SELECT 'week'::"text",
            ("date_trunc"('week'::"text", ("base"."day")::timestamp with time zone))::"date" AS "date_trunc",
            "count"(DISTINCT "base"."session_id") AS "count",
            "count"(*) AS "count"
           FROM "base"
          GROUP BY 'week'::"text", (("date_trunc"('week'::"text", ("base"."day")::timestamp with time zone))::"date")
        UNION ALL
         SELECT 'month'::"text",
            ("date_trunc"('month'::"text", ("base"."day")::timestamp with time zone))::"date" AS "date_trunc",
            "count"(DISTINCT "base"."session_id") AS "count",
            "count"(*) AS "count"
           FROM "base"
          GROUP BY 'month'::"text", (("date_trunc"('month'::"text", ("base"."day")::timestamp with time zone))::"date")
        UNION ALL
         SELECT 'quarter'::"text",
            ("date_trunc"('quarter'::"text", ("base"."day")::timestamp with time zone))::"date" AS "date_trunc",
            "count"(DISTINCT "base"."session_id") AS "count",
            "count"(*) AS "count"
           FROM "base"
          GROUP BY 'quarter'::"text", (("date_trunc"('quarter'::"text", ("base"."day")::timestamp with time zone))::"date")
        UNION ALL
         SELECT 'year'::"text",
            ("date_trunc"('year'::"text", ("base"."day")::timestamp with time zone))::"date" AS "date_trunc",
            "count"(DISTINCT "base"."session_id") AS "count",
            "count"(*) AS "count"
           FROM "base"
          GROUP BY 'year'::"text", (("date_trunc"('year'::"text", ("base"."day")::timestamp with time zone))::"date")
        )
 SELECT "granularity",
    "period_start",
    "unique_sessions",
    "total_events",
    "sum"("unique_sessions") OVER (PARTITION BY "granularity" ORDER BY "period_start") AS "cumulative_sessions",
    "sum"("total_events") OVER (PARTITION BY "granularity" ORDER BY "period_start") AS "cumulative_events"
   FROM "agg"
  ORDER BY "granularity", "period_start" DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_session_counts_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "case_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'SGD'::"text",
    "service_type" "text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "stripe_payment_intent_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    CONSTRAINT "payments_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "payments_service_type_check" CHECK (("service_type" = ANY (ARRAY['standard'::"text", 'nominee'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "referral_code" "text",
    "referred_by_code" "text",
    "referral_count" integer DEFAULT 0,
    "role" "public"."user_role" DEFAULT 'victim'::"public"."user_role",
    "phone_number" "text",
    "is_verified" boolean DEFAULT false,
    "verification_date" timestamp with time zone,
    "full_name" "text",
    "email_notifications" boolean DEFAULT true NOT NULL,
    "sms_notifications" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_system" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "source_url_raw" "text",
    "source_host" "text",
    "source_path" "text",
    "source_doc_id" "text",
    "jurisdiction_code" "text" NOT NULL,
    "forum_name" "text" NOT NULL,
    "forum_type" "text" NOT NULL,
    "case_number" "text",
    "published_at" timestamp with time zone,
    "decision_at" timestamp with time zone,
    "filed_at" timestamp with time zone,
    "incident_at" timestamp with time zone,
    "domain" "text" NOT NULL,
    "case_type" "text",
    "issues" "jsonb",
    "keywords" "jsonb",
    "claimant_role" "text",
    "respondent_role" "text",
    "respondent_entity_type" "text",
    "respondent_name" "text",
    "industry" "text",
    "claimant_representation" "text",
    "title" "text",
    "summary" "text",
    "full_text" "text",
    "sections" "jsonb",
    "decision_summary_overview" "jsonb",
    "issues_findings" "jsonb",
    "decision_terms" "jsonb",
    "timeline" "jsonb",
    "authorities" "jsonb",
    "evidence" "jsonb",
    "control_findings" "jsonb",
    "signals" "jsonb",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "outcome" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "outcome_favours" "text",
    "orders" "jsonb",
    "amounts" "jsonb",
    "compensation_amount" numeric,
    "compensation_currency" "text",
    "non_monetary_remedy" "jsonb",
    "costs_amount" numeric,
    "costs_currency" "text",
    "content_hash" "text",
    "embedding_ref" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inbox_id" "uuid",
    "embedding" "public"."vector"(1536),
    CONSTRAINT "public_decisions_outcome_chk" CHECK (("outcome" = ANY (ARRAY['upheld'::"text", 'partly_upheld'::"text", 'not_upheld'::"text", 'dismissed'::"text", 'settled'::"text", 'withdrawn'::"text", 'jurisdiction_declined'::"text", 'unknown'::"text"]))),
    CONSTRAINT "public_decisions_outcome_favours_chk" CHECK ((("outcome_favours" IS NULL) OR ("outcome_favours" = ANY (ARRAY['claimant'::"text", 'respondent'::"text", 'mixed'::"text", 'unknown'::"text"]))))
);


ALTER TABLE "public"."public_decisions" OWNER TO "postgres";


COMMENT ON TABLE "public"."public_decisions" IS 'A jurisdiction-agnostic canonical table for storing published dispute resolution decisions issued by courts, tribunals, ombudsman schemes, and similar adjudicative bodies across multiple countries and legal domains.  Each row represents one final, published decision (or determination / award / order), normalised so that outcomes from financial disputes, employment disputes, tenancy disputes, consumer claims, and small-claims matters can be analysed and compared consistently.';



COMMENT ON COLUMN "public"."public_decisions"."source_url" IS 'Canonical decision URL (unique).';



COMMENT ON COLUMN "public"."public_decisions"."issues_findings" IS 'Array of issue-level findings: [{issue, finding, reasoning_short, finding_tags...}]';



COMMENT ON COLUMN "public"."public_decisions"."timeline" IS 'Key dated events: [{date, label, details}].';



COMMENT ON COLUMN "public"."public_decisions"."authorities" IS 'Citations: statutes, codes, cases, contract terms, guidance.';



CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_user_id" "uuid",
    "referral_code" "text" NOT NULL,
    "referred_email" "text",
    "referred_user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "reward_type" "text",
    "reward_amount" numeric,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "converted_at" timestamp with time zone,
    "rewarded_at" timestamp with time zone,
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'converted'::"text", 'rewarded'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regulatory_clauses" (
    "id" "uuid" NOT NULL,
    "document_id" "uuid",
    "clause_ref" "text",
    "clause_type" "text",
    "title" "text",
    "text_content" "text" NOT NULL,
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "embedding" "public"."vector"
);


ALTER TABLE "public"."regulatory_clauses" OWNER TO "postgres";


COMMENT ON TABLE "public"."regulatory_clauses" IS 'This table stores atomic, addressable regulatory clauses extracted from authoritative regulatory documents.';



CREATE TABLE IF NOT EXISTS "public"."regulatory_documents" (
    "id" "uuid" NOT NULL,
    "source" "text",
    "regulator" "text",
    "jurisdiction" "text",
    "document_title" "text" NOT NULL,
    "version" "text",
    "issue_date" "date",
    "effective_date" "date",
    "definitions" "text",
    "duties_fi" "text",
    "duties_telco" "text",
    "loss_sharing_rules" "text",
    "raw_json" "jsonb",
    "full_text" "tsvector",
    "embedding" "public"."vector"(1536),
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "document_key" "text"
);


ALTER TABLE "public"."regulatory_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."regulatory_documents" IS 'This table stores authoritative regulatory, legislative, and policy source documents used by the system for reference, retrieval, and reasoning support.';



CREATE TABLE IF NOT EXISTS "public"."router_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_token" "text" NOT NULL,
    "dispute_narrative" "text",
    "voice_transcript" "text",
    "audio_file_url" "text",
    "classification_result" "jsonb",
    "clarifying_questions" "jsonb",
    "user_responses" "jsonb",
    "eligibility_assessment" "jsonb",
    "recommended_path" "text",
    "converted_to_case_id" "uuid",
    "converted_at" timestamp with time zone,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "converted_to_user_id" "uuid",
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    CONSTRAINT "router_sessions_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'CONVERTED'::"text", 'EXPIRED'::"text", 'IMPORTED'::"text"])))
);


ALTER TABLE "public"."router_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_entitlements" (
    "user_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_entitlements" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_entitlements" IS 'Stores the current entitlement state for a user: which plan they’re on and what feature flags / limits apply (in features JSON). Used by the app + edge functions to gate Tier-0 / Tier-1 / Tier-2 capabilities.';



CREATE OR REPLACE VIEW "public"."v_latest_validation" AS
 SELECT DISTINCT ON ("extract_run_id") "id",
    "case_id",
    "extract_run_id",
    "intake_id",
    "missing_fields",
    "ambiguities",
    "questions_to_user",
    "validation_summary",
    "status",
    "source",
    "model_name",
    "prompt_version",
    "schema_version",
    "is_valid",
    "raw_output",
    "error_message",
    "created_at"
   FROM "public"."case_validation_runs"
  ORDER BY "extract_run_id", "created_at" DESC;


ALTER VIEW "public"."v_latest_validation" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_latest_validation_run" AS
 SELECT DISTINCT ON ("extract_run_id") "id",
    "case_id",
    "extract_run_id",
    "intake_id",
    "missing_fields",
    "ambiguities",
    "questions_to_user",
    "validation_summary",
    "status",
    "source",
    "model_name",
    "prompt_version",
    "schema_version",
    "is_valid",
    "raw_output",
    "error_message",
    "created_at"
   FROM "public"."case_validation_runs"
  ORDER BY "extract_run_id", "created_at" DESC;


ALTER VIEW "public"."v_latest_validation_run" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'landing_page'::"text",
    "name" "text",
    "first_name" "text",
    "last_name" "text"
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anonymized_training_data"
    ADD CONSTRAINT "anonymized_training_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_collaborators"
    ADD CONSTRAINT "case_collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_decision_runs"
    ADD CONSTRAINT "case_decision_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_document_chunks"
    ADD CONSTRAINT "case_document_chunks_content_id_chunk_index_key" UNIQUE ("content_id", "chunk_index");



ALTER TABLE ONLY "public"."case_document_chunks"
    ADD CONSTRAINT "case_document_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_document_extractions"
    ADD CONSTRAINT "case_document_extractions_document_id_extraction_type_schem_key" UNIQUE ("document_id", "extraction_type", "schema_version", "model", "prompt_version");



ALTER TABLE ONLY "public"."case_document_extractions"
    ADD CONSTRAINT "case_document_extractions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_document_verifications"
    ADD CONSTRAINT "case_document_verifications_document_id_content_id_model_pr_key" UNIQUE ("document_id", "content_id", "model", "prompt_version");



ALTER TABLE ONLY "public"."case_document_verifications"
    ADD CONSTRAINT "case_document_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_documents_content"
    ADD CONSTRAINT "case_documents_content_document_id_model_prompt_version_pip_key" UNIQUE ("document_id", "model", "prompt_version", "pipeline_version");



ALTER TABLE ONLY "public"."case_documents_content"
    ADD CONSTRAINT "case_documents_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_documents"
    ADD CONSTRAINT "case_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_entitlements"
    ADD CONSTRAINT "case_entitlements_pkey" PRIMARY KEY ("case_id");



ALTER TABLE ONLY "public"."case_events"
    ADD CONSTRAINT "case_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_extract_runs"
    ADD CONSTRAINT "case_extract_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_intake"
    ADD CONSTRAINT "case_intake_case_id_version_uniq" UNIQUE ("case_id", "version");



ALTER TABLE ONLY "public"."case_intake"
    ADD CONSTRAINT "case_intake_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_narratives"
    ADD CONSTRAINT "case_narratives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_outcomes"
    ADD CONSTRAINT "case_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_responses"
    ADD CONSTRAINT "case_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_validation_runs"
    ADD CONSTRAINT "case_validation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consent_logs"
    ADD CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_sources_inbox"
    ADD CONSTRAINT "decision_sources_inbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_sources_inbox"
    ADD CONSTRAINT "decision_sources_inbox_source_url_key" UNIQUE ("source_url");



ALTER TABLE ONLY "public"."evidence"
    ADD CONSTRAINT "evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invitation_token_key" UNIQUE ("invitation_token");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."llm_runs"
    ADD CONSTRAINT "llm_runs_case_id_task_prompt_version_key" UNIQUE ("case_id", "task", "prompt_version");



ALTER TABLE ONLY "public"."llm_runs"
    ADD CONSTRAINT "llm_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."public_decisions"
    ADD CONSTRAINT "public_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_decisions"
    ADD CONSTRAINT "public_decisions_source_url_key" UNIQUE ("source_url");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."regulatory_clauses"
    ADD CONSTRAINT "regulatory_clauses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regulatory_documents"
    ADD CONSTRAINT "regulatory_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."router_sessions"
    ADD CONSTRAINT "router_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."router_sessions"
    ADD CONSTRAINT "router_sessions_session_token_key" UNIQUE ("session_token");



ALTER TABLE ONLY "public"."user_entitlements"
    ADD CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "case_decision_runs_case_id_created_at_idx" ON "public"."case_decision_runs" USING "btree" ("case_id", "created_at" DESC);



CREATE UNIQUE INDEX "case_document_extractions_uniq" ON "public"."case_document_extractions" USING "btree" ("document_id", "extraction_type", "schema_version");



CREATE UNIQUE INDEX "case_documents_storage_unique" ON "public"."case_documents" USING "btree" ("storage_bucket", "storage_path");



CREATE INDEX "case_entitlements_expires_at_idx" ON "public"."case_entitlements" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "cases_case_key_unique" ON "public"."cases" USING "btree" ("case_key") WHERE ("case_key" IS NOT NULL);



CREATE INDEX "idx_anonymized_training_data_category" ON "public"."anonymized_training_data" USING "btree" ("dispute_category");



CREATE INDEX "idx_anonymized_training_data_outcome" ON "public"."anonymized_training_data" USING "btree" ("outcome_type");



CREATE INDEX "idx_case_collaborators_case_id" ON "public"."case_collaborators" USING "btree" ("case_id");



CREATE INDEX "idx_case_collaborators_status" ON "public"."case_collaborators" USING "btree" ("status");



CREATE INDEX "idx_case_collaborators_user_id" ON "public"."case_collaborators" USING "btree" ("user_id");



CREATE INDEX "idx_case_decision_runs_case_id" ON "public"."case_decision_runs" USING "btree" ("case_id");



CREATE INDEX "idx_case_decision_runs_created_at" ON "public"."case_decision_runs" USING "btree" ("created_at");



CREATE INDEX "idx_case_documents_case_id" ON "public"."case_documents" USING "btree" ("case_id");



CREATE INDEX "idx_case_documents_sha256" ON "public"."case_documents" USING "btree" ("sha256");



CREATE INDEX "idx_case_documents_status" ON "public"."case_documents" USING "btree" ("processing_status");



CREATE INDEX "idx_case_events_case_time" ON "public"."case_events" USING "btree" ("case_id", "event_time");



CREATE INDEX "idx_case_events_case_type" ON "public"."case_events" USING "btree" ("case_id", "event_type");



CREATE INDEX "idx_case_extract_runs_case_id" ON "public"."case_extract_runs" USING "btree" ("case_id");



CREATE INDEX "idx_case_extract_runs_created_at" ON "public"."case_extract_runs" USING "btree" ("created_at");



CREATE INDEX "idx_case_intake_case_id_version_desc" ON "public"."case_intake" USING "btree" ("case_id", "version" DESC);



CREATE INDEX "idx_case_intake_confirmed_by_case" ON "public"."case_intake" USING "btree" ("case_id") WHERE ("is_user_confirmed" = true);



CREATE INDEX "idx_case_narratives_case_type_created" ON "public"."case_narratives" USING "btree" ("case_id", "narrative_type", "created_at" DESC);



CREATE INDEX "idx_case_responses_case_id" ON "public"."case_responses" USING "btree" ("case_id");



CREATE INDEX "idx_cases_creator_user_id" ON "public"."cases" USING "btree" ("creator_user_id");



CREATE INDEX "idx_cases_owner_user_id" ON "public"."cases" USING "btree" ("owner_user_id");



CREATE INDEX "idx_cases_router_session_id" ON "public"."cases" USING "btree" ("router_session_id");



CREATE INDEX "idx_cases_status" ON "public"."cases" USING "btree" ("case_status");



CREATE INDEX "idx_cdc_content_id" ON "public"."case_document_chunks" USING "btree" ("content_id");



CREATE INDEX "idx_cdc_created_at" ON "public"."case_document_chunks" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cdc_document" ON "public"."case_documents_content" USING "btree" ("document_id");



CREATE INDEX "idx_cdc_fts" ON "public"."case_document_chunks" USING "gin" ("to_tsvector"('"english"'::"regconfig", "chunk_text"));



CREATE INDEX "idx_cdc_parsed_at" ON "public"."case_documents_content" USING "btree" ("parsed_at" DESC);



CREATE INDEX "idx_cde_case" ON "public"."case_document_extractions" USING "btree" ("case_id");



CREATE INDEX "idx_cde_document" ON "public"."case_document_extractions" USING "btree" ("document_id");



CREATE INDEX "idx_cde_type" ON "public"."case_document_extractions" USING "btree" ("extraction_type");



CREATE INDEX "idx_cdv_decision" ON "public"."case_document_verifications" USING "btree" ("decision");



CREATE INDEX "idx_cdv_document" ON "public"."case_document_verifications" USING "btree" ("document_id");



CREATE INDEX "idx_decision_sources_inbox_status" ON "public"."decision_sources_inbox" USING "btree" ("status");



CREATE INDEX "idx_evidence_case_id" ON "public"."evidence" USING "btree" ("case_id");



CREATE INDEX "idx_evidence_category" ON "public"."evidence" USING "btree" ("category");



CREATE INDEX "idx_evidence_user_id" ON "public"."evidence" USING "btree" ("user_id");



CREATE INDEX "idx_invitations_case_id" ON "public"."invitations" USING "btree" ("case_id");



CREATE INDEX "idx_invitations_invitation_token" ON "public"."invitations" USING "btree" ("invitation_token");



CREATE INDEX "idx_invitations_invitee_email" ON "public"."invitations" USING "btree" ("invitee_email");



CREATE INDEX "idx_invitations_status" ON "public"."invitations" USING "btree" ("status");



CREATE INDEX "idx_mv_pages_per_session_session" ON "public"."mv_pages_per_session" USING "btree" ("session_id");



CREATE INDEX "idx_mv_session_counts_day" ON "public"."mv_session_counts" USING "btree" ("day");



CREATE INDEX "idx_mv_session_counts_periods" ON "public"."mv_session_counts_periods" USING "btree" ("granularity", "period_start");



CREATE INDEX "idx_profiles_referral_code" ON "public"."profiles" USING "btree" ("referral_code");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_public_decisions_authorities_gin" ON "public"."public_decisions" USING "gin" ("authorities");



CREATE INDEX "idx_public_decisions_case_number" ON "public"."public_decisions" USING "btree" ("case_number");



CREATE INDEX "idx_public_decisions_decision_at" ON "public"."public_decisions" USING "btree" ("decision_at");



CREATE INDEX "idx_public_decisions_domain" ON "public"."public_decisions" USING "btree" ("domain");



CREATE INDEX "idx_public_decisions_forum" ON "public"."public_decisions" USING "btree" ("forum_name");



CREATE INDEX "idx_public_decisions_inbox_id" ON "public"."public_decisions" USING "btree" ("inbox_id");



CREATE INDEX "idx_public_decisions_issues_findings_gin" ON "public"."public_decisions" USING "gin" ("issues_findings");



CREATE INDEX "idx_public_decisions_issues_gin" ON "public"."public_decisions" USING "gin" ("issues");



CREATE INDEX "idx_public_decisions_jurisdiction" ON "public"."public_decisions" USING "btree" ("jurisdiction_code");



CREATE INDEX "idx_public_decisions_outcome" ON "public"."public_decisions" USING "btree" ("outcome");



CREATE INDEX "idx_public_decisions_published_at" ON "public"."public_decisions" USING "btree" ("published_at");



CREATE INDEX "idx_public_decisions_respondent_name" ON "public"."public_decisions" USING "btree" ("respondent_name");



CREATE INDEX "idx_public_decisions_signals_gin" ON "public"."public_decisions" USING "gin" ("signals");



CREATE INDEX "idx_public_decisions_timeline_gin" ON "public"."public_decisions" USING "gin" ("timeline");



CREATE INDEX "idx_referrals_code" ON "public"."referrals" USING "btree" ("referral_code");



CREATE INDEX "idx_referrals_referred_user" ON "public"."referrals" USING "btree" ("referred_user_id");



CREATE INDEX "idx_referrals_referrer" ON "public"."referrals" USING "btree" ("referrer_user_id");



CREATE INDEX "idx_referrals_status" ON "public"."referrals" USING "btree" ("status");



CREATE INDEX "idx_router_sessions_converted_to_case_id" ON "public"."router_sessions" USING "btree" ("converted_to_case_id");



CREATE INDEX "idx_router_sessions_converted_to_user_id" ON "public"."router_sessions" USING "btree" ("converted_to_user_id");



CREATE INDEX "idx_router_sessions_created_at" ON "public"."router_sessions" USING "btree" ("created_at");



CREATE INDEX "idx_router_sessions_session_token" ON "public"."router_sessions" USING "btree" ("session_token");



CREATE INDEX "ix_case_decision_runs_validation" ON "public"."case_decision_runs" USING "btree" ("validation_run_id");



CREATE INDEX "ix_case_validation_runs_case_created" ON "public"."case_validation_runs" USING "btree" ("case_id", "created_at" DESC);



CREATE INDEX "ix_regulatory_clauses_clause_ref" ON "public"."regulatory_clauses" USING "btree" ("clause_ref");



CREATE INDEX "ix_regulatory_clauses_clause_type" ON "public"."regulatory_clauses" USING "btree" ("clause_type");



CREATE INDEX "ix_regulatory_clauses_document_id" ON "public"."regulatory_clauses" USING "btree" ("document_id");



CREATE INDEX "reports_case_id_idx" ON "public"."reports" USING "btree" ("case_id");



CREATE INDEX "reports_case_user_type_idx" ON "public"."reports" USING "btree" ("case_id", "user_id", "report_type");



CREATE INDEX "reports_inputs_hash_idx" ON "public"."reports" USING "btree" ("inputs_hash");



CREATE UNIQUE INDEX "reports_unique_user_case_type_hash" ON "public"."reports" USING "btree" ("user_id", "case_id", "report_type", "inputs_hash");



CREATE INDEX "reports_user_id_idx" ON "public"."reports" USING "btree" ("user_id");



CREATE UNIQUE INDEX "ux_case_decision_runs_case_extract" ON "public"."case_decision_runs" USING "btree" ("case_id", "extract_run_id") WHERE ("extract_run_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_case_intake_case_id" ON "public"."case_intake" USING "btree" ("case_id");



CREATE UNIQUE INDEX "ux_case_narratives_case_type_source" ON "public"."case_narratives" USING "btree" ("case_id", "narrative_type", "source_ref");



CREATE UNIQUE INDEX "ux_case_validation_runs_extract_run" ON "public"."case_validation_runs" USING "btree" ("extract_run_id");



CREATE OR REPLACE TRIGGER "trg_case_entitlements_set_updated_at" BEFORE UPDATE ON "public"."case_entitlements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_public_decisions_set_updated_at" BEFORE UPDATE ON "public"."public_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_case_intake_version" BEFORE INSERT ON "public"."case_intake" FOR EACH ROW EXECUTE FUNCTION "public"."set_case_intake_version"();



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_collaborators"
    ADD CONSTRAINT "case_collaborators_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_collaborators"
    ADD CONSTRAINT "case_collaborators_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_collaborators"
    ADD CONSTRAINT "case_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_decision_runs"
    ADD CONSTRAINT "case_decision_runs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_decision_runs"
    ADD CONSTRAINT "case_decision_runs_extract_run_id_fkey" FOREIGN KEY ("extract_run_id") REFERENCES "public"."case_extract_runs"("id");



ALTER TABLE ONLY "public"."case_decision_runs"
    ADD CONSTRAINT "case_decision_runs_validation_run_id_fkey" FOREIGN KEY ("validation_run_id") REFERENCES "public"."case_validation_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_document_chunks"
    ADD CONSTRAINT "case_document_chunks_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."case_documents_content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_document_extractions"
    ADD CONSTRAINT "case_document_extractions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_document_extractions"
    ADD CONSTRAINT "case_document_extractions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."case_documents_content"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_document_extractions"
    ADD CONSTRAINT "case_document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."case_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_document_verifications"
    ADD CONSTRAINT "case_document_verifications_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."case_documents_content"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_document_verifications"
    ADD CONSTRAINT "case_document_verifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."case_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_documents"
    ADD CONSTRAINT "case_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_documents_content"
    ADD CONSTRAINT "case_documents_content_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."case_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_entitlements"
    ADD CONSTRAINT "case_entitlements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_events"
    ADD CONSTRAINT "case_events_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_extract_runs"
    ADD CONSTRAINT "case_extract_runs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_extract_runs"
    ADD CONSTRAINT "case_extract_runs_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "public"."case_intake"("id");



ALTER TABLE ONLY "public"."case_intake"
    ADD CONSTRAINT "case_intake_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_narratives"
    ADD CONSTRAINT "case_narratives_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_narratives"
    ADD CONSTRAINT "case_narratives_decision_run_id_fkey" FOREIGN KEY ("decision_run_id") REFERENCES "public"."case_decision_runs"("id");



ALTER TABLE ONLY "public"."case_narratives"
    ADD CONSTRAINT "case_narratives_extract_run_id_fkey" FOREIGN KEY ("extract_run_id") REFERENCES "public"."case_extract_runs"("id");



ALTER TABLE ONLY "public"."case_narratives"
    ADD CONSTRAINT "case_narratives_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "public"."case_intake"("id");



ALTER TABLE ONLY "public"."case_outcomes"
    ADD CONSTRAINT "case_outcomes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_responses"
    ADD CONSTRAINT "case_responses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_validation_runs"
    ADD CONSTRAINT "case_validation_runs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_validation_runs"
    ADD CONSTRAINT "case_validation_runs_extract_run_id_fkey" FOREIGN KEY ("extract_run_id") REFERENCES "public"."case_extract_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_validation_runs"
    ADD CONSTRAINT "case_validation_runs_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "public"."case_intake"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consent_logs"
    ADD CONSTRAINT "consent_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evidence"
    ADD CONSTRAINT "evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evidence"
    ADD CONSTRAINT "evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regulatory_clauses"
    ADD CONSTRAINT "regulatory_clauses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."regulatory_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."router_sessions"
    ADD CONSTRAINT "router_sessions_converted_to_case_id_fkey" FOREIGN KEY ("converted_to_case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."router_sessions"
    ADD CONSTRAINT "router_sessions_converted_to_user_id_fkey" FOREIGN KEY ("converted_to_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_entitlements"
    ADD CONSTRAINT "user_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow anonymous insert for router sessions" ON "public"."router_sessions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow anonymous select for router sessions" ON "public"."router_sessions" FOR SELECT USING (true);



CREATE POLICY "Allow anonymous update for router sessions" ON "public"."router_sessions" FOR UPDATE USING (true);



CREATE POLICY "Allow public insert on waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public select on waitlist" ON "public"."waitlist" FOR SELECT USING (true);



CREATE POLICY "Case owner can manage collaborators" ON "public"."case_collaborators" USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_collaborators"."case_id") AND ("cases"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "Collaborators can view their invitations" ON "public"."case_collaborators" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("auth"."uid"() = "inviter_user_id")));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."cases" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."consent_logs" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can create referrals" ON "public"."referrals" FOR INSERT WITH CHECK (("auth"."uid"() = "referrer_user_id"));



CREATE POLICY "Users can delete own case documents" ON "public"."case_documents" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_documents"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own cases" ON "public"."cases" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own evidence" ON "public"."evidence" FOR DELETE USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "evidence"."case_id") AND ("cases"."owner_user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert analytics events" ON "public"."analytics_events" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR ("user_id" IS NULL)));



CREATE POLICY "Users can insert own case documents" ON "public"."case_documents" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_documents"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own case outcomes" ON "public"."case_outcomes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_outcomes"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own case responses" ON "public"."case_responses" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_responses"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own payments" ON "public"."payments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can read their own referrals" ON "public"."referrals" FOR SELECT USING ((("auth"."uid"() = "referrer_user_id") OR ("auth"."uid"() = "referred_user_id")));



CREATE POLICY "Users can update own case documents" ON "public"."case_documents" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_documents"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own case outcomes" ON "public"."case_outcomes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_outcomes"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own case responses" ON "public"."case_responses" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_responses"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own cases" ON "public"."cases" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can upload evidence to their cases" ON "public"."evidence" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "evidence"."case_id") AND (("cases"."owner_user_id" = "auth"."uid"()) OR ("cases"."creator_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."case_collaborators"
          WHERE (("case_collaborators"."case_id" = "cases"."id") AND ("case_collaborators"."user_id" = "auth"."uid"()) AND ("case_collaborators"."status" = 'active'::"text") AND ('write'::"text" = ANY ("case_collaborators"."permissions"))))))))));



CREATE POLICY "Users can view evidence for their cases" ON "public"."evidence" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "evidence"."case_id") AND (("cases"."owner_user_id" = "auth"."uid"()) OR ("cases"."creator_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."case_collaborators"
          WHERE (("case_collaborators"."case_id" = "cases"."id") AND ("case_collaborators"."user_id" = "auth"."uid"()) AND ("case_collaborators"."status" = 'active'::"text")))))))));



CREATE POLICY "Users can view own analytics events" ON "public"."analytics_events" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own case documents" ON "public"."case_documents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_documents"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own case outcomes" ON "public"."case_outcomes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_outcomes"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own case responses" ON "public"."case_responses" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cases"
  WHERE (("cases"."id" = "case_responses"."case_id") AND ("cases"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own cases" ON "public"."cases" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own consent logs" ON "public"."consent_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own payments" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anonymized_training_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_collaborators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_decision_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_document_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_document_extractions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_document_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_documents_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_extract_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_intake" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_narratives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_outcomes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_validation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."consent_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."decision_sources_inbox" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entitlements_select_own" ON "public"."user_entitlements" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."llm_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regulatory_clauses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regulatory_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."router_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_effective_entitlement"("p_case_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_effective_entitlement"("p_case_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_entitlement"("p_case_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_latest_decision_run"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_decision_run"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_decision_run"() TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_entitlement"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_entitlement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_entitlement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_feature (feature_key text)"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_feature (feature_key text)"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_feature (feature_key text)"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_public_decisions"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."match_public_decisions"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_public_decisions"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_public_decisions_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."match_public_decisions_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_public_decisions_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_regulatory_clauses_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_regulatory_clauses_threshold"("query_embedding" "public"."vector", "match_count" integer, "similarity_threshold" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."run_validation_v1"("p_extract_run_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."run_validation_v1"("p_extract_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_validation_v1"("p_extract_run_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_case_intake_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_case_intake_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_case_intake_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_case_document_from_storage"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_case_document_from_storage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_case_document_from_storage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_report_selfserve_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_report_selfserve_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_report_selfserve_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";









GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."anonymized_training_data" TO "anon";
GRANT ALL ON TABLE "public"."anonymized_training_data" TO "authenticated";
GRANT ALL ON TABLE "public"."anonymized_training_data" TO "service_role";



GRANT ALL ON TABLE "public"."case_collaborators" TO "anon";
GRANT ALL ON TABLE "public"."case_collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."case_collaborators" TO "service_role";



GRANT ALL ON TABLE "public"."case_decision_runs" TO "anon";
GRANT ALL ON TABLE "public"."case_decision_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."case_decision_runs" TO "service_role";



GRANT ALL ON TABLE "public"."case_document_chunks" TO "anon";
GRANT ALL ON TABLE "public"."case_document_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."case_document_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."case_document_extractions" TO "anon";
GRANT ALL ON TABLE "public"."case_document_extractions" TO "authenticated";
GRANT ALL ON TABLE "public"."case_document_extractions" TO "service_role";



GRANT ALL ON TABLE "public"."case_document_verifications" TO "anon";
GRANT ALL ON TABLE "public"."case_document_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."case_document_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."case_documents" TO "anon";
GRANT ALL ON TABLE "public"."case_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."case_documents" TO "service_role";



GRANT ALL ON TABLE "public"."case_documents_content" TO "anon";
GRANT ALL ON TABLE "public"."case_documents_content" TO "authenticated";
GRANT ALL ON TABLE "public"."case_documents_content" TO "service_role";



GRANT ALL ON TABLE "public"."case_documents_enriched" TO "anon";
GRANT ALL ON TABLE "public"."case_documents_enriched" TO "authenticated";
GRANT ALL ON TABLE "public"."case_documents_enriched" TO "service_role";



GRANT ALL ON TABLE "public"."case_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."case_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."case_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."case_events" TO "anon";
GRANT ALL ON TABLE "public"."case_events" TO "authenticated";
GRANT ALL ON TABLE "public"."case_events" TO "service_role";



GRANT ALL ON TABLE "public"."case_extract_runs" TO "anon";
GRANT ALL ON TABLE "public"."case_extract_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."case_extract_runs" TO "service_role";



GRANT ALL ON TABLE "public"."case_intake" TO "anon";
GRANT ALL ON TABLE "public"."case_intake" TO "authenticated";
GRANT ALL ON TABLE "public"."case_intake" TO "service_role";



GRANT ALL ON TABLE "public"."case_narratives" TO "anon";
GRANT ALL ON TABLE "public"."case_narratives" TO "authenticated";
GRANT ALL ON TABLE "public"."case_narratives" TO "service_role";



GRANT ALL ON TABLE "public"."case_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."case_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."case_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."case_responses" TO "anon";
GRANT ALL ON TABLE "public"."case_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."case_responses" TO "service_role";



GRANT ALL ON TABLE "public"."case_validation_runs" TO "anon";
GRANT ALL ON TABLE "public"."case_validation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."case_validation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."cases" TO "anon";
GRANT ALL ON TABLE "public"."cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cases" TO "service_role";



GRANT ALL ON TABLE "public"."complaints" TO "anon";
GRANT ALL ON TABLE "public"."complaints" TO "authenticated";
GRANT ALL ON TABLE "public"."complaints" TO "service_role";



GRANT ALL ON TABLE "public"."consent_logs" TO "anon";
GRANT ALL ON TABLE "public"."consent_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."consent_logs" TO "service_role";



GRANT ALL ON TABLE "public"."decision_sources_inbox" TO "anon";
GRANT ALL ON TABLE "public"."decision_sources_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_sources_inbox" TO "service_role";



GRANT ALL ON TABLE "public"."evidence" TO "anon";
GRANT ALL ON TABLE "public"."evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."evidence" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."llm_runs" TO "anon";
GRANT ALL ON TABLE "public"."llm_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."llm_runs" TO "service_role";



GRANT ALL ON TABLE "public"."mv_complaint_status_counts" TO "anon";
GRANT ALL ON TABLE "public"."mv_complaint_status_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_complaint_status_counts" TO "service_role";



GRANT ALL ON TABLE "public"."mv_country_rollup" TO "anon";
GRANT ALL ON TABLE "public"."mv_country_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_country_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."mv_funnel_durations" TO "anon";
GRANT ALL ON TABLE "public"."mv_funnel_durations" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_funnel_durations" TO "service_role";



GRANT ALL ON TABLE "public"."mv_pages_per_session" TO "anon";
GRANT ALL ON TABLE "public"."mv_pages_per_session" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_pages_per_session" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."mv_report_status_counts" TO "anon";
GRANT ALL ON TABLE "public"."mv_report_status_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_report_status_counts" TO "service_role";



GRANT ALL ON TABLE "public"."mv_session_counts" TO "anon";
GRANT ALL ON TABLE "public"."mv_session_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_session_counts" TO "service_role";



GRANT ALL ON TABLE "public"."mv_session_counts_periods" TO "anon";
GRANT ALL ON TABLE "public"."mv_session_counts_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_session_counts_periods" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."public_decisions" TO "anon";
GRANT ALL ON TABLE "public"."public_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."public_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON TABLE "public"."regulatory_clauses" TO "anon";
GRANT ALL ON TABLE "public"."regulatory_clauses" TO "authenticated";
GRANT ALL ON TABLE "public"."regulatory_clauses" TO "service_role";



GRANT ALL ON TABLE "public"."regulatory_documents" TO "anon";
GRANT ALL ON TABLE "public"."regulatory_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."regulatory_documents" TO "service_role";



GRANT ALL ON TABLE "public"."router_sessions" TO "anon";
GRANT ALL ON TABLE "public"."router_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."router_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."user_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."user_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."v_latest_validation" TO "anon";
GRANT ALL ON TABLE "public"."v_latest_validation" TO "authenticated";
GRANT ALL ON TABLE "public"."v_latest_validation" TO "service_role";



GRANT ALL ON TABLE "public"."v_latest_validation_run" TO "anon";
GRANT ALL ON TABLE "public"."v_latest_validation_run" TO "authenticated";
GRANT ALL ON TABLE "public"."v_latest_validation_run" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist" TO "anon";
GRANT ALL ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































