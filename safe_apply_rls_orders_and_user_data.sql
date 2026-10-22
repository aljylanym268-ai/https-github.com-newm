-- Diagnostic only. Do not use the former policy-creation script.
-- Its broad participant UPDATE policy could let a buyer or courier modify
-- order fields beyond the transitions allowed by the security hardening migration.
-- Review/apply the versioned migration after confirming it against the live schema.

SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'user_data')
ORDER BY tablename, policyname;

SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('orders', 'user_data')
ORDER BY event_object_table, trigger_name, event_manipulation;
