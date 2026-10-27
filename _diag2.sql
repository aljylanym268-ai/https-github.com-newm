-- Reproduce: does the policies reference match insert path? Check auth.uid() vs FK
SELECT c.conname, c.confrelid::regclass AS ref_table
FROM pg_constraint c WHERE c.conrelid = 'public.push_subscriptions'::regclass;
-- check for a second table with same name in another schema
SELECT schemaname, tablename FROM pg_tables WHERE tablename LIKE '%push%';
