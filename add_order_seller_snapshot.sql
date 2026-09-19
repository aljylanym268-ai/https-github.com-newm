-- Migration: store seller snapshot data in orders for delivery pickup
-- Run this in Supabase SQL editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS seller_address text,
  ADD COLUMN IF NOT EXISTS seller_center text,
  ADD COLUMN IF NOT EXISTS seller_governorate text;

-- Enable RLS if it is not already enabled
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

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
