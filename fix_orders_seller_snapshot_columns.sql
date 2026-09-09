-- Run this in the Supabase SQL Editor as a database administrator.
-- The checkout flow stores seller contact details on each order.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS seller_address text,
  ADD COLUMN IF NOT EXISTS seller_center text,
  ADD COLUMN IF NOT EXISTS seller_governorate text;

-- Reload PostgREST's schema cache immediately.
NOTIFY pgrst, 'reload schema';

-- Verify that all snapshot columns exist.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name IN (
    'seller_name',
    'seller_phone',
    'seller_address',
    'seller_center',
    'seller_governorate'
  )
ORDER BY column_name;
