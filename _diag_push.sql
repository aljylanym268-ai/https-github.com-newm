-- Diagnose push_subscriptions RLS state
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'push_subscriptions';
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'push_subscriptions';
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'push_subscriptions';
