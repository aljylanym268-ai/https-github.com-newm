-- ============================================================
-- MISAR SYSTEMS — إصلاح جذري: الزائر على لينك المتجر يشوف "البائع غير موجود"
-- ============================================================
-- النسخة الأولى (fix_public_store_view.sql) استخدمت CREATE VIEW — وفشلت لسببين:
--
--   1) PostgREST لا يرى أي VIEW/جدول جديد في public إلا بعد GRANT صريح
--      (تغيير كاسر في Supabase). ولو الجرانت ناقص يرجع:
--      { "code": "42501", "message": "permission denied for table public_stores" }
--      المرجع: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
--
--   2) CREATE VIEW يفشل بالكامل لو عمود واحد اسمه مختلف
--      (ERROR: column "bio" does not exist) — والمشروع فيه أعمدة بأسماء
--      مختلفة حسب الجدول (شوف التعليق في js/cart.js سطر 888).
--
-- الحل هنا: دالة RPC من نوع SECURITY DEFINER.
--   * لا تعتمد على أي view ولا تحتاج GRANT على جدول.
--   * تقرأ user_data بصلاحيات المالك (تتجاوز RLS عن قصد وبأمان).
--   * تُرجع الأعمدة العامة فقط: id / username / name / image_url / bio / account_type
--     ولا تُرجع الهاتف أو العنوان أو البريد إطلاقاً.
--   * تُبنى ديناميكياً حسب الأعمدة الموجودة فعلاً عندك — فلا تفشل لو اسم عمود مختلف.
--
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 0) تشخيص: اطبع أسماء الأعمدة الفعلية (مفيد للمراجعة)
-- ============================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_data'
ORDER BY ordinal_position;

-- ============================================================
-- 1) تنظيف أي محاولات سابقة
-- ============================================================
DROP FUNCTION IF EXISTS public.get_public_store(text);
DROP FUNCTION IF EXISTS public.get_public_store_by_username(text);
DROP VIEW     IF EXISTS public.public_stores;

-- ============================================================
-- 2) إنشاء الدالتين ديناميكياً حسب الأعمدة الموجودة فعلاً
-- ============================================================
DO $outer$
DECLARE
    cols       text[];
    name_expr  text;
    img_expr   text;
    bio_expr   text;
    type_expr  text;
    user_expr  text;
    where_user text;
    sql        text;
BEGIN
    SELECT array_agg(column_name) INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_data';

    IF cols IS NULL THEN
        RAISE EXCEPTION 'جدول public.user_data غير موجود';
    END IF;

    name_expr := CASE WHEN 'name' = ANY(cols) THEN 'NULLIF(u.name, '''')' ELSE 'NULL::text' END;

    img_expr := CASE
        WHEN 'image_url'  = ANY(cols) THEN 'NULLIF(u.image_url, '''')'
        WHEN 'avatar_url' = ANY(cols) THEN 'NULLIF(u.avatar_url, '''')'
        ELSE 'NULL::text'
    END;

    bio_expr := CASE WHEN 'bio' = ANY(cols) THEN 'NULLIF(u.bio, '''')' ELSE 'NULL::text' END;

    type_expr := CASE WHEN 'account_type' = ANY(cols) THEN 'u.account_type' ELSE '''seller''::text' END;

    IF 'username' = ANY(cols) THEN
        user_expr  := 'NULLIF(u.username, '''')';
        where_user := 'u.username = p_identifier';
    ELSE
        user_expr  := 'NULL::text';
        where_user := 'false';
    END IF;

    -- (أ) البحث بالـ id
    sql := format($fmt$
        CREATE OR REPLACE FUNCTION public.get_public_store(p_identifier text)
        RETURNS TABLE (
            id           uuid,
            username     text,
            name         text,
            image_url    text,
            bio          text,
            account_type text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = public
        AS $body$
            SELECT
                u.id,
                COALESCE(%s, NULLIF(%s, ''), 'store-' || left(u.id::text, 8)) AS username,
                COALESCE(%s, 'بائع') AS name,
                %s AS image_url,
                %s AS bio,
                %s AS account_type
            FROM public.user_data u
            WHERE %s = 'seller'
              AND u.id::text = p_identifier
            LIMIT 1;
        $body$;
    $fmt$, user_expr, name_expr, name_expr, img_expr, bio_expr, type_expr, type_expr);

    EXECUTE sql;

    -- (ب) البحث باسم المستخدم
    sql := format($fmt$
        CREATE OR REPLACE FUNCTION public.get_public_store_by_username(p_identifier text)
        RETURNS TABLE (
            id           uuid,
            username     text,
            name         text,
            image_url    text,
            bio          text,
            account_type text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = public
        AS $body$
            SELECT
                u.id,
                COALESCE(%s, NULLIF(%s, ''), 'store-' || left(u.id::text, 8)) AS username,
                COALESCE(%s, 'بائع') AS name,
                %s AS image_url,
                %s AS bio,
                %s AS account_type
            FROM public.user_data u
            WHERE %s = 'seller'
              AND %s
            LIMIT 1;
        $body$;
    $fmt$, user_expr, name_expr, name_expr, img_expr, bio_expr, type_expr, type_expr, where_user);

    EXECUTE sql;
END $outer$;

-- ============================================================
-- 3) صلاحية التنفيذ للزوار والمسجلين
--    (الدالة هي الواجهة الوحيدة — لا يوجد وصول مباشر لجدول user_data)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_public_store(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_store_by_username(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 4) تحقق: لازم يرجع صفوف البائعين
--    (لو رجع صفر صفوف، معناها مفيش حساب account_type = 'seller')
-- ============================================================
SELECT 'عدد البائعين' AS test, count(*)::text AS value
FROM public.user_data WHERE account_type = 'seller'
UNION ALL
SELECT 'عيّنة أسماء مستخدمين', string_agg(COALESCE(username, '(بدون username)'), ' | ')
FROM public.user_data WHERE account_type = 'seller';

-- ============================================================
-- 5) تحقق أمني: نتأكد أن جدول user_data نفسه ما زال مغلقاً للزوار
-- ============================================================
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_data'
ORDER BY policyname;