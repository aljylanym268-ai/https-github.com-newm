-- Restore visibility for admin/founder users to SELECT from orders
-- Run this in Supabase SQL editor as an admin

-- Ensure RLS is enabled (no-op if already enabled)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows users with account_type 'founder' or 'admin' in user_data to SELECT all rows
DROP POLICY IF EXISTS "orders_select_for_admins" ON public.orders;

CREATE POLICY "orders_select_for_admins"
ON public.orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_data ud
    WHERE ud.id = auth.uid()
      AND ud.account_type IN ('founder', 'admin')
  )
  OR buyer_id = auth.uid() OR seller_id = auth.uid() OR delivery_id = auth.uid()
);

-- Notes:
-- * This policy is additive: PostgreSQL evaluates all SELECT policies and a row is visible if any policy returns true.
-- * If your admin role has a different account_type value (e.g., 'superadmin' or 'owner'), add it to the IN(...) list.
-- * After running, test by logging in as an admin/founder and querying orders; the rows should reappear.
