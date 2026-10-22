-- Diagnostic only. The former policy script could expose available orders to
-- unapproved couriers and create recursive orders/user_data RLS checks.
-- Use the reviewed versioned security migration and preserve existing order
-- policies until they have been checked against the live schema.

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
