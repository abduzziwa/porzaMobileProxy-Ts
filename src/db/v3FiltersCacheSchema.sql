-- Shared filter-facet cache. The filter options for a given
-- (category_ids/categories, ktype_ids, language) combo are identical for every
-- caller, so this is fetched from Corenio once and reused by all devices/users —
-- unlike the per-device Redis cache used elsewhere in v3Cache middleware.
CREATE TABLE IF NOT EXISTS v3_filters_cache (
  id         SERIAL PRIMARY KEY,
  cache_key  VARCHAR UNIQUE NOT NULL,   -- sha256 of { filters, language }
  filters    JSONB NOT NULL,            -- normalised { category_ids?, categories?, ktype_ids? } used to fetch this
  language   VARCHAR NOT NULL,
  data       JSONB NOT NULL,            -- the { success, brands, properties } response
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
