-- Run this in the Supabase SQL Editor as a database administrator.
-- Allows an authenticated customer to create an order for themselves.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buyers_insert_own_orders" ON public.orders;
CREATE POLICY "buyers_insert_own_orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (buyer_id = (select auth.uid()));

-- Keep seller and delivery updates restricted to their own orders.
DROP POLICY IF EXISTS "sellers_update_own_orders" ON public.orders;
CREATE POLICY "sellers_update_own_orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  seller_id = (select auth.uid())
  OR buyer_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
)
WITH CHECK (
  seller_id = (select auth.uid())
  OR buyer_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
);

NOTIFY pgrst, 'reload schema';

-- Diagnostics: the first result must show the logged-in user's UUID.
SELECT auth.uid() AS current_user_id;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'orders'
ORDER BY policyname;
