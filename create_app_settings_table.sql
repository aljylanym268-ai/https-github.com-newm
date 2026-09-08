-- ============================================================
-- MISAR SYSTEMS - جدول إعدادات التطبيق + عدّادات الزيارات
-- يخزن: deleted_governorates / deleted_centers / extra_centers
--       + total_visits / daily_visits
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor
-- ============================================================

-- 1. إنشاء جدول app_settings إذا لم يكن موجوداً
CREATE TABLE IF NOT EXISTS public.app_settings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    setting_key text NOT NULL UNIQUE,
    setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. تفعيل RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 3. سياسة القراءة: الجميع (حتى الضيوف غير المسجلين) - مطلوب للعدّادات والقوائم
DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
CREATE POLICY "app_settings_read_all" ON public.app_settings
    FOR SELECT
    USING (true);

-- 3.1 سياسات كتابة العدّادات فقط: أي زائر (حتى غير مسجل) - مقيّدة بمفتاحي العدّادات
DROP POLICY IF EXISTS "app_settings_visit_counters_update" ON public.app_settings;
CREATE POLICY "app_settings_visit_counters_update" ON public.app_settings
    FOR UPDATE
    USING (setting_key IN ('total_visits', 'daily_visits'))
    WITH CHECK (setting_key IN ('total_visits', 'daily_visits'));

DROP POLICY IF EXISTS "app_settings_visit_counters_insert" ON public.app_settings;
CREATE POLICY "app_settings_visit_counters_insert" ON public.app_settings
    FOR INSERT
    WITH CHECK (setting_key IN ('total_visits', 'daily_visits'));

-- 4. سياسات الكتابة/التعديل/الحذف: المؤسس فقط (account_type = 'founder')
--    ملاحظة: لو اسم عمود نوع الحساب عندك مختلف غيّر user_data.account_type
DROP POLICY IF EXISTS "app_settings_founder_insert" ON public.app_settings;
CREATE POLICY "app_settings_founder_insert" ON public.app_settings
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_data ud
            WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
        )
    );

DROP POLICY IF EXISTS "app_settings_founder_update" ON public.app_settings;
CREATE POLICY "app_settings_founder_update" ON public.app_settings
    FOR UPDATE TO authenticated
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

DROP POLICY IF EXISTS "app_settings_founder_delete" ON public.app_settings;
CREATE POLICY "app_settings_founder_delete" ON public.app_settings
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_data ud
            WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
        )
    );

-- 5. تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION public.touch_app_settings()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;
CREATE TRIGGER app_settings_touch
    BEFORE UPDATE ON public.app_settings
    FOR EACH ROW EXECUTE FUNCTION public.touch_app_settings();

-- 6. صفوف البداية (فارغة) - اختياري لكن مفيد للتشغيل الأول
INSERT INTO public.app_settings (setting_key, setting_value) VALUES
    ('deleted_governorates', '[]'::jsonb),
    ('deleted_centers', '{}'::jsonb),
    ('extra_centers', '{}'::jsonb),
    ('total_visits', '0'::jsonb),
    ('daily_visits', '{"date": "", "count": 0}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================
-- ملاحظات:
-- 1) الكود في js/supabase.js بيعمل upsert على الجدول ده —
--    عمود setting_key لازم يكون UNIQUE زي ما هو فوق عشان upsert ينجح.
-- 2) لو نوع الحساب عندك مخزن في مكان تاني (مثلاً users.role)
--    عدّل الشرط في السياسات رقم 4.
-- ============================================================
