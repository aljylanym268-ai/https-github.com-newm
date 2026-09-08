-- ============================================================
-- ملف إصلاح طارئ لسياسات RLS - نظام مسار
-- شغّل ده في Supabase Dashboard → SQL Editor
-- ده هيصلح خطأ "infinite recursion detected in policy" ويرجّع التطبيق يشتغل
-- ============================================================

-- ============================================
-- الخطوة 1: شوف السياسات الموجودة حالياً (شغّل ده الأول وقول لي النتيجة)
-- ============================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================
-- الخطوة 2: حذف كل السياسات على user_data (اللي مسببة الـ recursion)
-- ============================================
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_data'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_data', pol.policyname);
    END LOOP;
END $$;

-- ============================================
-- الخطوة 3: إنشاء سياسات جديدة آمنة على user_data
-- (آمنة لأنها مش بتعمل استعلام على نفس الجدول)
-- ============================================

-- كل مستخدم مسجل يشوف بيانات كل المستخدمين (مطلوب عشان المندوب يشوف عنوان البائع والعميل)
CREATE POLICY "user_data_select_authenticated"
ON public.user_data
FOR SELECT
TO authenticated
USING (true);

-- كل مستخدم يشوف بياناته العامة حتى بدون تسجيل (للمنتجات والبائعين في المتجر)
CREATE POLICY "user_data_select_anon"
ON public.user_data
FOR SELECT
TO anon
USING (true);

-- المستخدم يقدر يعمل صف بياناته عند التسجيل
CREATE POLICY "user_data_insert_own"
ON public.user_data
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- المستخدم يعدّل بياناته هو بس
CREATE POLICY "user_data_update_own"
ON public.user_data
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ============================================
-- الخطوة 4: اتأكد إن RLS مفعّل على الجداول الحساسة
-- ============================================
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- ============================================
-- الخطوة 5: اختبار سريع بعد التطبيق
-- ============================================
-- لو ده رجع صفوف من غير خطأ recursion، يبقى تمام
SELECT count(*) AS user_data_count FROM public.user_data;
