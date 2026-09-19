-- Admin dashboard: login accounts, sessions, and audit log. Separate from
-- everything customer-facing (v3_users, v3_device_sessions) on purpose —
-- this is the operator/client-admin side, not the mobile app side.
-- Idempotent — safe to re-run.

-- Two roles: 'mother' (full cross-client view + infra control, built last)
-- and 'client' (scoped to exactly one client's own data). client_id is NULL
-- for mother admins, required for client admins. Even though there's only
-- one real client (Porza) today, this column exists now so onboarding a
-- second client later needs no schema change — just a new row.
CREATE TABLE IF NOT EXISTS v3_admins (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(100) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(20) NOT NULL CHECK (role IN ('mother', 'client')),
  client_id      VARCHAR(50),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMP,
  CONSTRAINT v3_admins_client_role_check CHECK (
    (role = 'mother' AND client_id IS NULL) OR
    (role = 'client' AND client_id IS NOT NULL)
  )
);

-- Server-side session storage, not a bare JWT — lets a session be revoked
-- instantly (e.g. an admin account gets disabled, or a device is reported
-- lost) instead of waiting out a token's own expiry. Only a sha256 hash of
-- the real token is ever stored; the raw token lives only in the browser's
-- httpOnly cookie, never on disk.
CREATE TABLE IF NOT EXISTS v3_admin_sessions (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER NOT NULL REFERENCES v3_admins(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP NOT NULL,
  ip_address  VARCHAR(45),
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_v3_admin_sessions_admin  ON v3_admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_v3_admin_sessions_expiry ON v3_admin_sessions(expires_at);

-- Every meaningful admin action — separate from v3_device_analytics, which
-- is END-USER activity, not operator activity. Login attempts (success AND
-- failure — failures are what a brute-force attempt looks like here) and
-- messages sent go here now; mother-admin actions (client created,
-- container stopped) land here too once that's built.
CREATE TABLE IF NOT EXISTS v3_admin_audit_log (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER REFERENCES v3_admins(id) ON DELETE SET NULL,
  action     VARCHAR(50) NOT NULL,
  meta       JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v3_admin_audit_admin ON v3_admin_audit_log(admin_id, created_at DESC);
