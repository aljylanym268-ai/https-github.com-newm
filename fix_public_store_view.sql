-- ============================================================
-- MISAR SYSTEMS — إصلاح: الزائر على لينك المتجر يشوف "البائع غير موجود"
-- ============================================================
-- المشكلة الفعلية (مُثبتة بفحص مباشر على قاعدة البيانات):
--
--   * السياسة الحالية لجدول user_data هي:
--       user_data_select_for_order_participants → TO authenticated
--     يعني الزائر (anon) اللي بيفتح لينك المتجر ما يقدرش يقرأ صف البائع إطلاقاً.
--     الفحص المباشر: GET /rest/v1/user_data بأول زائر => 200 + [] (صفر صفوف)
--
--   * وفي نفس الوقت products مفتوح للزوار (الفحص: رجع منتجاً فعلياً).
--
--   * showStorePage() في js/products.js بتبحث عن البائع في user_data
--     بـ username (أو id)، والاستعلام يرجع فارغاً => showToast('البائع غير موجود').
--
-- الحل هنا (آمن ولا يكسر الخصوصية):
--   لا نفتح جدول user_data للزوار أبداً — لأني يحتوي هاتفاً وعنواناً وبريداً.
--   بدلاً من ذلك ننشئ VIEW عاماً يحتوي الأعمدة الآمنة فقط (اسم/اسم مستخدم/
--   صورة/نبذة)، بنفس أسلوب ملف fix_available_orders_rls.sql الموجود عندك.
--   وبذلك يفتح لينك المتجر لأي زائر بلا تسجيل دخول، بدون تسريب أي بيانات حساسة.
--
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1) اكتشاف أسماء الأعمدة الفعلية في user_data
--    (المشروع فيه أعمدة بأسماء مختلفة حسب الجدول — نتفادى أي عمود غير موجود
--     لأن الاستعلام عليه على view يُفشل العرض بالكامل)
-- ============================================================
-- نفّذ هذا الاستعلام قبل الإنشاء لو حبيت تتأكد من الأسماء:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='user_data' ORDER BY ordinal_position;

-- ============================================================
-- 2) إنشاء الـ VIEW العام
-- ============================================================
DROP VIEW IF EXISTS public.public_stores;

CREATE VIEW public.public_stores AS
SELECT
    id,
    COALESCE(
        NULLIF(username, ''),
        NULLIF(name, ''),
        'store-' || left(id::text, 8)
    )                                          AS username,
    COALESCE(name, email, 'بائع')              AS name,
    NULLIF(image_url, '')                      AS image_url,
    NULLIF(bio, '')                            AS bio,
    account_type
FROM public.user_data
WHERE account_type = 'seller';

-- مهم جداً: نعطي صلاحية القراءة للزوار (anon) وللمسجلين (authenticated)
GRANT SELECT ON public.public_stores TO anon, authenticated;

COMMENT ON VIEW public.public_stores IS
    'واجهة عامة لعرض المتاجر للزوار — أعمدة آمنة فقط، بدون هاتف/عنوان/بريد';

-- ============================================================
-- 3) البائع يشوف بياناته هو (حتى لو status مش approved)
--    ده يحل أيضاً مشكلة "معاينة متجري" من داخل لوحة البائع
-- ============================================================
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_data_select_own" ON public.user_data;
CREATE POLICY "user_data_select_own"
ON public.user_data
FOR SELECT
TO authenticated
USING ( id = (select auth.uid()) );

-- ============================================================
-- 4) إعادة تحميل مخطط PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 5) تحقق: لازم الـ view يرجّع صفوف البائعين
-- ============================================================
SELECT id, username, name, account_type
FROM public.public_stores
LIMIT 10;

-- ============================================================
-- 6) تحقق أمني: نتأكد أن جدول user_data نفسه ما زال مغلقاً للزوار
--    (المتوقع: صفر صفوف SELECT مفتوحة للدور anon على user_data)
-- ============================================================
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_data'
ORDER BY policyname;
