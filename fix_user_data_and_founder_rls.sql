-- DEPRECATED: The former version granted unrestricted SELECT on user_data to
-- anon and authenticated users and allowed self-service role/status updates.
-- Do not run the historical version of this script.
--
-- Review and manually apply, if appropriate, the least-privilege migration:
--   supabase/migrations/20261020_user_data_security_hardening.sql
--
-- This file is intentionally diagnostic-only. It does not change database
-- policies or data.
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_data', 'founder_settings')
ORDER BY tablename, policyname;
