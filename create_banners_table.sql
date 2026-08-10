-- Migration: create banners table for hero banners
-- Run this in Supabase SQL editor or via psql

CREATE TABLE IF NOT EXISTS public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text,
  link text,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Optional: create index for active + sort_order
CREATE INDEX IF NOT EXISTS idx_banners_active_sort ON public.banners (active, sort_order);
