-- Diagnostic only. The former policy queried orders directly from a user_data
-- policy and could reintroduce recursive RLS evaluation or broader profile
-- access when combined with existing permissive policies.
-- The reviewed versioned migration defines the participant check as a
-- SECURITY DEFINER function and replaces the user_data policies transactionally.

SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_data'
ORDER BY policyname;

SELECT
  trigger_name,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'user_data'
ORDER BY trigger_name, event_manipulation;
