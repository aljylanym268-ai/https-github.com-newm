-- DEPRECATED: This former emergency script granted unrestricted SELECT on
-- public.user_data to anon and authenticated, and allowed self-service role
-- changes. Do not run the historical version of this script.
--
-- Review and manually apply, if appropriate, the least-privilege migration:
--   supabase/migrations/20261020_user_data_security_hardening.sql
--
-- This file is intentionally diagnostic-only. It does not change database
-- policies or data.
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_data'
ORDER BY policyname;
