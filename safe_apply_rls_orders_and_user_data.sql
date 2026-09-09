-- Safe script to (re)create RLS policies for orders and user_data
-- Run this in Supabase SQL editor as an admin (do NOT run as anon/unauthenticated)
-- This script DROPs any existing conflicting policies (if present) before creating the intended ones,
-- avoiding errors like "policy ... already exists".

-- Ensure RLS is enabled
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- ===== Orders policies (drop-if-exists then create) =====
DROP POLICY IF EXISTS "buyers_insert_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_select_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_update_own_orders" ON public.orders;

CREATE POLICY "buyers_insert_own_orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "buyers_select_own_orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  buyer_id = auth.uid() OR seller_id = auth.uid() OR delivery_id = auth.uid()
);

CREATE POLICY "buyers_update_own_orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  buyer_id = auth.uid() OR seller_id = auth.uid() OR delivery_id = auth.uid()
)
WITH CHECK (
  buyer_id = auth.uid() OR seller_id = auth.uid() OR delivery_id = auth.uid()
);

-- ===== user_data policy to allow order participants to read seller records =====
DROP POLICY IF EXISTS "user_data_select_for_order_participants" ON public.user_data;

CREATE POLICY "user_data_select_for_order_participants"
ON public.user_data
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE (o.buyer_id = auth.uid() OR o.seller_id = auth.uid() OR o.delivery_id = auth.uid())
      AND o.seller_id = public.user_data.id
  )
);

-- Notes:
-- * Running this will replace these specific policies; if you have other custom policies on these tables
--   you should review them before running. This script only touches the named policies.
-- * After applying, test the behavior by attempting to SELECT from public.user_data for a seller id
--   while logged in as a user participating in an order that references that seller.
-- * If you want admins/founders to see all user_data, add an additional policy scoped to that role.
