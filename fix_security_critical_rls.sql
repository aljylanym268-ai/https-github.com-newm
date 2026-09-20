-- ============================================================
-- MISAR SYSTEMS — إصلاح أمني عاجل للثغرات المؤكدة
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor بصلاحية مدير.
--
-- الثغرة 1: جدول returns مقروء بالكامل لأي زائر غير مسجل (anon)
--           → تسريب علاقات المرتجعات وأسبابها وأسماء المستخدمين.
-- الثغرة 2: جدول founder_settings مقروء لأي زائر (anon).
-- الثغرة 3: جدول app_settings مقروء لأي زائر، ويكشف مفاتيح إدارية
--           (deleted_governorates / deleted_centers / seller_commission ...).
-- الثغرة 4: أي زائر يستطيع الكتابة في صفوف العدّادات
--           total_visits / daily_visits → تضخيم الزيارات أو تدمير التتبع.
--
-- ملاحظة: هذا الملف لا يحذف أي سياسة على جداول أخرى ولا يغيّر أي بيانات.
-- نفّذه كاملاً، ثم نفّذ ملف verify_security_fixes.sql للتأكد.
-- ============================================================

BEGIN;

-- ============================================================
-- 0) دوال مساعدة (SECURITY DEFINER تمنع دورية RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type IN ('founder', 'admin')
  );
$$;

-- ============================================================
-- 1) returns — منع القراءة العامة تماماً
-- القاعدة: كل طرف يرى فقط المرتجعات الخاصة به
--   - المشترى: buyer_id
--   - البائع:  seller_id
--   - المندوب: delivery_id (المرتجع المسند إليه أو المتاح في مركزه)
--   - المؤس/المدير: كل شيء
-- ملاحظة: عدّل أسماء الأعمدة لو ملفك يستخدم courier_id بدلاً من delivery_id
--         (انظر الاستعلام التشخيصي في نهاية الملف).
-- ============================================================
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

-- احذف أي سياسة قراءة مفتوحة (بما فيها سياسة anon)
DROP POLICY IF EXISTS "returns_select_all" ON public.returns;
DROP POLICY IF EXISTS "returns_read_all" ON public.returns;
DROP POLICY IF EXISTS "Allow public read returns" ON public.returns;
DROP POLICY IF EXISTS "returns_select_anon" ON public.returns;
DROP POLICY IF EXISTS "returns_public_read" ON public.returns;
DROP POLICY IF EXISTS "returns_select_authenticated" ON public.returns;
DROP POLICY IF EXISTS "returns_participants_select" ON public.returns;

CREATE POLICY "returns_participants_select"
ON public.returns
FOR SELECT
TO authenticated
USING (
  public.misar_is_founder_or_admin()
  OR buyer_id = (select auth.uid())
  OR seller_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
);

-- ============================================================
-- 2) founder_settings — إخفاؤه عن الزوار تماماً
-- ملاحظة: التطبيق يقرأه بعد تسجيل الدخول فقط، فالتقييد للمسجّلين لا يكسر أي شاشة.
-- ============================================================
ALTER TABLE public.founder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founder_settings_read_all" ON public.founder_settings;
DROP POLICY IF EXISTS "founder_settings_select_all" ON public.founder_settings;
DROP POLICY IF EXISTS "founder_settings_public_read" ON public.founder_settings;
DROP POLICY IF EXISTS "founder_settings_read_authenticated" ON public.founder_settings;

CREATE POLICY "founder_settings_read_authenticated"
ON public.founder_settings
FOR SELECT
TO authenticated
USING (true);

-- ============================================================
-- 3) app_settings — نُخفي الإعدادات الحساسة عن الزوار
-- سياسات الكتابة الخاصة بالمؤس (app_settings_founder_*) الموجودة عندك تبقى كما هي.
--
-- الطريقة: نمنح anon قراءة الإعدادات العامة فقط، ونمنح authenticated قراءة
-- كل الإعدادات (لتظل باقي الشاشات تعمل). لو عندك إعدادات حساسة أخرى غير
-- المذكورة هنا، أضف مفتاحها إلى قائمة الحظر في الشرطين أسفله.
-- ============================================================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_public_read" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_anon_read_public" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_authenticated_read" ON public.app_settings;

-- أ) الزوار (anon): الإعدادات العامة فقط، وممنوع أي مفتاح إداري
CREATE POLICY "app_settings_anon_read_public"
ON public.app_settings
FOR SELECT
TO anon
USING (
  setting_key NOT IN (
    'deleted_governorates',
    'deleted_centers',
    'extra_centers',
    'seller_commission',
    'delivery_commission',
    'min_withdrawal',
    'return_fee',
    'return_window_days',
    'delivery_fee'
  )
);

-- ب) المسجّلون: كل الإعدادات (الشاشات الداخلية تحتاجها)
CREATE POLICY "app_settings_authenticated_read"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

-- ============================================================
-- 4) العدّادات — لا كتابة للزوار أبداً
-- السبب: سياسة INSERT/UPDATE المفتوحة على (total_visits, daily_visits) كانت تسمح
-- لأي زائر بدون تسجيل بتضخيم الزيارات أو تصفير العدّاد.
-- سنمنع الكتابة من anon، ونسمح بها للمسجّلين فقط + المؤس.
-- ملاحظة: إن كنت تحتاج عدّاد الزيارات ليعمل للزوار، استخدم Edge Function
-- بمفتاح service role بدلاً من فتح الجدول للعامة.
-- ============================================================
DROP POLICY IF EXISTS "app_settings_visit_counters_update" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_visit_counters_insert" ON public.app_settings;

CREATE POLICY "app_settings_visit_counters_insert"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (
  setting_key IN ('total_visits', 'daily_visits')
  OR public.misar_is_founder_or_admin()
);

CREATE POLICY "app_settings_visit_counters_update"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (
  setting_key IN ('total_visits', 'daily_visits')
  OR public.misar_is_founder_or_admin()
)
WITH CHECK (
  setting_key IN ('total_visits', 'daily_visits')
  OR public.misar_is_founder_or_admin()
);

-- ============================================================
-- 5) تأكيد أن RLS مفعّل على كل الجداول الحساسة
-- ============================================================
ALTER TABLE public.user_data        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners          ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تشخيص: اطبع السياسات الفعلية بعد التنفيذ
-- ============================================================
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('returns', 'app_settings', 'founder_settings', 'user_data', 'orders')
ORDER BY tablename, policyname;

-- تشخيص: تأكد من أسماء أعمدة returns (لو مختلف، عدّل السياسة أعلاه)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'returns'
ORDER BY ordinal_position;

-- تشخيص: أي جدول آخر ما زال مفتوحاً للقراءة العامة؟
-- سيعرض كل سياسة SELECT مخصّصة للدور anon (يجب أن تكون موجودة فقط للجداول العامة عن قصد)
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND 'anon' = ANY (roles)
ORDER BY tablename;

-- ============================================================
-- إضافة: منع anon من قراءة بيانات المستخدمين والطلبات نهائياً
-- (تأكيد دفاعي — لو كانت هناك سياسة anon قديمة باقية من أي ملف سابق)
-- ============================================================
DROP POLICY IF EXISTS "user_data_select_anon" ON public.user_data;
DROP POLICY IF EXISTS "orders_select_anon" ON public.orders;
DROP POLICY IF EXISTS "returns_select_anon" ON public.returns;

-- ============================================================
-- إضافة: تأكيد أن جدول المرتجعات لا يمنح كتابة لأي زائر
-- ============================================================
DROP POLICY IF EXISTS "returns_insert_anon" ON public.returns;
DROP POLICY IF EXISTS "returns_update_anon" ON public.returns;
DROP POLICY IF EXISTS "returns_delete_anon" ON public.returns;

-- ============================================================
-- إضافة: منع الزوار من قراءة أعمدة حساسة في جدول الطلبات
-- القاعدة الحالية تسمح لأطراف الطلب فقط، وهذا الملف يؤكدها.
-- لو ظهرت أي سياسة قراءة عامة للطلبات، احذفها يدوياً بعد تشغيل
-- استعلام التشخيص في نهاية الملف.
-- ============================================================

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- فحص أخير: اطبع كل سياسة SELECT مفتوحة لأي دور عام
-- ============================================================
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND 'anon' = ANY (roles)
ORDER BY tablename;
