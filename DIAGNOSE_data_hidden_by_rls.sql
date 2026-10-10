-- ============================================================
-- MISAR SYSTEMS — تشخيص: هل البيانات اتمسحت أم مخفية بـ RLS؟
-- ------------------------------------------------------------
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor
-- (الـ SQL Editor بيعمل اتصال بصلاحية service_role ويتبطل RLS،
--  فلو الأرقام هنا كبيرة ⇒ البيانات موجودة، والمشكلة RLS فقط).
-- ============================================================

-- 1) إجمالي المستخدمين الموجودين فعلاً في الجدول (بدون RLS)
SELECT
  'user_data'                      AS table_name,
  count(*)                         AS total_rows,
  count(*) FILTER (WHERE account_type = 'founder')         AS founders,
  count(*) FILTER (WHERE account_type = 'admin')           AS admins,
  count(*) FILTER (WHERE account_type = 'general_manager') AS general_managers,
  count(*) FILTER (WHERE account_type = 'seller')          AS sellers,
  count(*) FILTER (WHERE account_type = 'delivery')        AS deliveries,
  count(*) FILTER (WHERE account_type = 'client')          AS clients,
  count(*) FILTER (WHERE account_type IS NULL)             AS NULL_type
FROM public.user_data;

-- 2) عيّنة من المستخدمين (أكبر من 2 لو الـ RLS هي السبب)
SELECT id, name, email, account_type, status, created_at
FROM public.user_data
ORDER BY created_at DESC
LIMIT 30;

-- 3) كل جداول البيانات الأساسية — للتأكد إن مفيش حاجة اتمسحت
SELECT 'orders'      AS t, count(*) FROM public.orders
UNION ALL SELECT 'products',    count(*) FROM public.products
UNION ALL SELECT 'returns',     count(*) FROM public.returns
UNION ALL SELECT 'banners',     count(*) FROM public.banners
UNION ALL SELECT 'app_settings',count(*) FROM public.app_settings
UNION ALL SELECT 'activity_logs',count(*) FROM public.activity_logs
ORDER BY t;

-- ============================================================
-- 4) الحالة الحالية لسياسات user_data
--    لو ظهرت الاختيارات كلها معتمدة على misar_is_founder_or_admin
--    ⇒ أكّدنا السبب.
-- ============================================================
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_data'
ORDER BY policyname;

-- ============================================================
-- 5) هل الدالة الحالية بتحتوي على 'admin' أم لا؟
--    النسخة القديمة كانت: account_type IN ('founder','admin')
--    النسخة الجديدة (بعد general_manager_system.sql): founder فقط.
-- ============================================================
SELECT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('misar_is_founder_or_admin','misar_is_founder','misar_is_general_manager');
