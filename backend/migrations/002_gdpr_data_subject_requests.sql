-- Personal data handling: an audit table for erasure requests and a retention function for execution logs.
-- Run after 001_initial_schema.sql (idempotent, safe to re-run). The export and erasure endpoints are the Edge
-- Functions export-my-data and delete-my-account in supabase/functions/.

-- One row per erased account. It records THAT an erasure happened and when, and nothing about who: the id is random
-- (never derived from the user id or the email), there is no foreign key to auth.users and no other column. Row level
-- security is on with no policy, so only the service role (which the erasure function uses) can read or write it.
CREATE TABLE IF NOT EXISTS erasure_audit (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('account_erasure')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE erasure_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erasure_audit FROM anon, authenticated;
COMMENT ON TABLE erasure_audit IS 'Account erasures: random request id, action and time only, no personal data';

-- Supabase Auth keeps its own event log, auth.audit_log_entries, whose payload holds the user's id and email
-- (actor_id, actor_username, and the traits of a user_deleted event). Deleting the auth user does not touch it, so the
-- erasure function calls this after the delete to remove every entry that names the id or the email. Service role only.
CREATE OR REPLACE FUNCTION erase_auth_audit_traces(p_user_id UUID, p_email TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  DELETE FROM auth.audit_log_entries
  WHERE strpos(lower(payload::text), lower(p_user_id::text)) > 0
     OR (p_email IS NOT NULL AND p_email <> '' AND strpos(lower(payload::text), lower(p_email)) > 0);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION erase_auth_audit_traces(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erase_auth_audit_traces(UUID, TEXT) TO service_role;
COMMENT ON FUNCTION erase_auth_audit_traces IS 'Removes auth.audit_log_entries rows that name an erased user by id or email';

-- Retention: delete execution log lines older than p_days (GDPR Article 5(1)(e), storage limitation).
-- 90 days is the longest per-user retention_days setting, so this is the hard ceiling and the per-user archival
-- still applies first for users who chose 7 or 30. Only the service role and the database owner can call it.
CREATE OR REPLACE FUNCTION purge_old_execution_logs(p_days INTEGER DEFAULT 90)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed BIGINT;
BEGIN
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'p_days must be at least 1, got %', p_days;
  END IF;
  DELETE FROM execution_logs WHERE "timestamp" < NOW() - make_interval(days => p_days);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION purge_old_execution_logs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_old_execution_logs(INTEGER) TO service_role;
COMMENT ON FUNCTION purge_old_execution_logs IS 'Deletes execution_logs rows older than p_days days and returns how many';

-- Schedule: every day at 03:17 UTC through pg_cron when the database has it (Supabase does; enable it on the hosted
-- project under Database, Extensions). On a Postgres without pg_cron nothing is scheduled and the same call has to
-- come from any scheduler: SELECT purge_old_execution_logs(90);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-old-execution-logs';
    PERFORM cron.schedule('purge-old-execution-logs', '17 3 * * *', 'SELECT public.purge_old_execution_logs(90)');
  ELSE
    RAISE NOTICE 'pg_cron is not available: call purge_old_execution_logs(90) from an external scheduler';
  END IF;
END
$$;
