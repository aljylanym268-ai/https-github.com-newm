-- ============================================================
-- MISAR SYSTEMS — تشخيص فوري: ليه لوحة المؤسس مش ظاهرة؟
-- ------------------------------------------------------------
-- شغّل هذا الملف كاملاً في:
--   Supabase Dashboard → SQL Editor → Run
-- ثم ابعث لي النتيجة كاملة.
--
-- هذا الملف للقراءة فقط (SELECT) — لا يعدّل ولا يحذف أي شيء.
-- ============================================================

-- ① هل حسابك موجود في auth.users أصلاً؟
SELECT
  '① auth.users' AS step,
  u.id,
  u.email,
  u.created_at,
  u.raw_user_meta_data ->> 'account_type' AS meta_account_type,
  u.raw_user_meta_data ->> 'status'       AS meta_status
FROM auth.users u
WHERE lower(u.email) = 'sa3dgelany@gmail.com';

-- ② هل صفك موجود في user_data وما نوعه الحالي؟
SELECT
  '② user_data' AS step,
  d.id,
  d.name,
  d.email,
  d.account_type,
  d.status,
  d.created_at
FROM public.user_data d
WHERE lower(d.email) = 'sa3dgelany@gmail.com'
   OR d.id = (SELECT id FROM auth.users WHERE lower(email) = 'sa3dgelany@gmail.com');

-- ③ بحث شامل: أي صف فيه كلمة sa3dgelany (للتأكد من ألا يوجد تكرار)
SELECT
  '③ بحث بالبريد' AS step,
  d.id, d.name, d.email, d.account_type, d.status
FROM public.user_data d
WHERE d.email ILIKE '%sa3dgelany%'
   OR d.name  ILIKE '%sa3dgelany%'
   OR d.name  ILIKE '%سعد%';

-- ④ كم حساب founder موجود في الجدول (ولمَن)؟
SELECT
  '④ كل حسابات المؤسس' AS step,
  d.id, d.name, d.email, d.account_type, d.status
FROM public.user_data d
WHERE d.account_type IN ('founder', 'admin', 'general_manager')
ORDER BY d.account_type;

-- ⑤ إجمالي المستخدمين لكل نوع (للتأكد أن البيانات سليمة)
SELECT
  '⑤ إجمالي الأنواع' AS step,
  COALESCE(d.account_type, '(بدون نوع)') AS account_type,
  count(*) AS cnt
FROM public.user_data d
GROUP BY d.account_type
ORDER BY cnt DESC;

-- ⑥ السياسات الحالية على user_data (هل RLS تمنع قراءة المؤسس؟)
SELECT
  '⑥ سياسات user_data' AS step,
  policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_data'
ORDER BY policyname;

-- ⑦ هل الدوال المطلوبة موجودة؟ وما تعريف misar_is_founder؟
SELECT
  '⑦ الدوال' AS step,
  p.proname,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('misar_is_founder', 'misar_is_general_manager', 'misar_is_founder_or_admin')
ORDER BY p.proname;
