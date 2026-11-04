-- ============================================================
-- نموذج إضافة منتج محسّن — أعمدة جديدة على جدول products
-- نُفِّذ مرة واحدة في Supabase SQL Editor.
-- (لا يحذف أي بيانات — إضافة أعمدة فقط)
-- ============================================================

-- 1) عمود حالة المنتج (draft / published / hidden / review / deleted)
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','hidden','review','deleted'));

-- 2) خيارات المنتج (ألوان + مقاسات) كمصفوفات نصية
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS colors text[] DEFAULT '{}';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sizes  text[] DEFAULT '{}';

-- 3) إعادة تحميل مخطط PostgREST حتى تتعرف الواجهة على الأعمدة فورًا
NOTIFY pgrst, 'reload schema';
