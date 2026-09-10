-- Run in Supabase SQL Editor as admin.
-- This fixes both user_data access and founder page visibility.

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('user_data','founder_settings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.founder_settings (
  id bigint PRIMARY KEY,
  page_visible boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.founder_settings (id, page_visible)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "user_data_select_authenticated"
ON public.user_data
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "user_data_select_anon"
ON public.user_data
FOR SELECT
TO anon
USING (true);

CREATE POLICY "user_data_insert_own"
ON public.user_data
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "user_data_update_own"
ON public.user_data
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "founder_settings_read_all"
ON public.founder_settings
FOR SELECT
USING (true);

CREATE POLICY "founder_settings_founder_write"
ON public.founder_settings
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_data ud
    WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_data ud
    WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
  )
);

NOTIFY pgrst, 'reload schema';

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('user_data','founder_settings')
ORDER BY tablename, policyname;
