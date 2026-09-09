-- Allow authenticated users who participate in an order to SELECT the seller's user_data
-- Run this in Supabase SQL editor as an admin (DO NOT run as an anonymous user)

-- 1) Ensure RLS is enabled on user_data (safe if already enabled)
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- 2) Create a policy that allows:
--    - a user to read their own user_data (id = auth.uid())
--    - a user who is buyer, seller, or delivery in any order to read that order's seller record

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
-- * This policy permits an authenticated user to read the seller's user_data when the authenticated user
--   is participating in an order that references that seller (as buyer, seller or delivery). It does NOT
--   grant broad read access to all user_data rows.
-- * If you have admin/founder roles that should be able to read any user_data, add an additional policy
--   scoped to those roles. Example (if you use a `role` column in user_data or a separate roles table):
--   CREATE POLICY "user_data_select_admins" ON public.user_data FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

-- After applying, test as a user who participates in an order that the SELECT now returns the seller row.
