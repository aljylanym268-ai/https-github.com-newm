-- Run this in the Supabase SQL editor as an administrator.
-- Allows sellers to read and update their own orders during confirmation.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sellers_select_own_orders" ON public.orders;
CREATE POLICY "sellers_select_own_orders"
ON public.orders
FOR SELECT
TO authenticated
USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "sellers_update_own_orders" ON public.orders;
CREATE POLICY "sellers_update_own_orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (seller_id = auth.uid())
WITH CHECK (seller_id = auth.uid());

-- Check whether old orders have no buyer reference.
SELECT id, seller_id, buyer_id, status, created_at
FROM public.orders
WHERE buyer_id IS NULL;
