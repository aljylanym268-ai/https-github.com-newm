-- ============================================================
-- MISAR SYSTEMS - إضافة أعمدة بيانات العنوان لجدول user_data الموجود
-- لا يتم إنشاء أي جدول جديد - يتم استخدام الجدول الموجود فقط
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor
-- ============================================================

-- 1. إضافة الأعمدة إذا لم تكن موجودة
ALTER TABLE public.user_data
    ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
    ADD COLUMN IF NOT EXISTS address text DEFAULT '',
    ADD COLUMN IF NOT EXISTS address_notes text DEFAULT '',
    ADD COLUMN IF NOT EXISTS email text;

-- 2. تحديث الأعمدة للسجلات القديمة من user_metadata (اختياري)
UPDATE public.user_data
SET phone    = COALESCE(phone, (auth.users.user_metadata->>'phone')::text, '')
FROM (SELECT id, user_metadata FROM auth.users) AS auth_users
WHERE user_data.id = auth_users.id
  AND (user_data.phone IS NULL OR user_data.phone = '')
  AND auth.users.user_metadata->>'phone' IS NOT NULL;

-- 3. التأكد من تفعيل RLS
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- 4. سياسات RLS: كل مستخدم يرى ويعدل سجله فقط (لو لم تكن موجودة)
DROP POLICY IF EXISTS "users_select_own_data" ON public.user_data;
CREATE POLICY "users_select_own_data" ON public.user_data
    FOR SELECT TO authenticated
    USING (id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_data" ON public.user_data;
CREATE POLICY "users_insert_own_data" ON public.user_data
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "users_update_own_data" ON public.user_data;
CREATE POLICY "users_update_own_data" ON public.user_data
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ملاحظة: لو كان المشروع يعتمد على سياسات موجودة تسمح للمؤسس/الأدمن بقراءة
-- كل السجلات (للوحة التحكم) فسيتم تفعيلها تلقائياً بدون حذفها.
-- نفحص فقط إن كان يوجد تعارض قبل التطبيق.
