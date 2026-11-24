-- IP locations for the technical-records evidence (FIDReC brief 3c; PR #42 request; lanes review of 24 Nov 2026,
-- Decision 10). Nothing is sent to a third party: lookups run against a copy of the IP database held here.
-- 1) ip_location_ranges: the IP database (DB-IP Lite to start), one row per range, with the database name and its
--    edition date. Several editions may be held; a lookup names the edition it uses. Reference data, service role only.
-- 2) lookup_ip_location_v1: the range holding an address in one edition.
-- 3) case_ip_locations: each lookup kept with its case, with the database name and edition it was made with (a pack
--    prints the lookup and the database date it was generated with). Deleted with the case. Read access like the
--    other case tables (app_case_permission 'view'); written by the server only.

CREATE TABLE public.ip_location_ranges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  database text NOT NULL CHECK (btrim(database) <> ''),
  database_edition date NOT NULL,
  range_start inet NOT NULL CHECK (masklen(range_start) = CASE family(range_start) WHEN 4 THEN 32 ELSE 128 END),
  range_end inet NOT NULL CHECK (masklen(range_end) = CASE family(range_end) WHEN 4 THEN 32 ELSE 128 END),
  country text,
  region text,
  city text,
  accuracy_radius_km integer CHECK (accuracy_radius_km >= 0),
  asn bigint CHECK (asn > 0),
  organisation text,
  -- Only where the database says so (contract IP_NETWORK_FLAGS). DB-IP Lite has none.
  flags text[] NOT NULL DEFAULT '{}' CHECK (flags <@ ARRAY['hosting', 'vpn', 'proxy']::text[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ip_location_ranges_order CHECK (family(range_start) = family(range_end) AND range_start <= range_end),
  UNIQUE (database, database_edition, range_start)
);

CREATE INDEX ip_location_ranges_lookup_idx
  ON public.ip_location_ranges (database, database_edition, family(range_start), range_start DESC);

CREATE OR REPLACE FUNCTION public.lookup_ip_location_v1(p_ip inet, p_database text, p_database_edition date)
RETURNS TABLE (
  ip inet, country text, region text, city text, accuracy_radius_km integer, asn bigint, organisation text,
  flags text[], database text, database_edition date
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT host(p_ip)::inet, r.country, r.region, r.city, r.accuracy_radius_km, r.asn, r.organisation, r.flags,
    r.database, r.database_edition
  FROM (
    SELECT * FROM public.ip_location_ranges x
    WHERE x.database = p_database AND x.database_edition = p_database_edition
      AND family(x.range_start) = family(p_ip) AND x.range_start <= p_ip
    ORDER BY x.range_start DESC
    LIMIT 1
  ) r
  WHERE r.range_end >= p_ip
$$;

CREATE TABLE public.case_ip_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  ip inet NOT NULL,
  country text,
  region text,
  city text,
  accuracy_radius_km integer CHECK (accuracy_radius_km >= 0),
  asn bigint CHECK (asn > 0),
  organisation text,
  flags text[] NOT NULL DEFAULT '{}' CHECK (flags <@ ARRAY['hosting', 'vpn', 'proxy']::text[]),
  database text NOT NULL CHECK (btrim(database) <> ''),
  database_edition date NOT NULL,
  -- Where the institution's record states a location itself; printed beside the lookup, each attributed.
  institution_stated_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, ip, database, database_edition)
);

CREATE INDEX case_ip_locations_case_idx ON public.case_ip_locations (case_id);

ALTER TABLE public.ip_location_ranges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ip_location_ranges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ip_location_ranges TO service_role;

ALTER TABLE public.case_ip_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_ip_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.case_ip_locations TO authenticated;
GRANT ALL ON public.case_ip_locations TO service_role;
CREATE POLICY case_ip_locations_select_authorized ON public.case_ip_locations
  FOR SELECT TO authenticated USING (public.app_case_permission(case_id, 'view'));

REVOKE ALL ON FUNCTION public.lookup_ip_location_v1(inet, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_ip_location_v1(inet, text, date) TO service_role;
