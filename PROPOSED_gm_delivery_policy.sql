-- ============================================================
-- MISAR SYSTEMS — مسودة مقترحة (لم تُنفَّذ)
-- إضافة صلاحية قراءة مستقلة للمناديب في لوحة المدير العام
-- + وظائف مساعدة لعرض قسم «المناديب» و«الخدمات» بشكل صحيح
-- ------------------------------------------------------------
-- ⚠️ هذه مسودة للمراجعة فقط. لا تنفّذها قبل موافقة المؤسس.
--
-- المبدأ:
--   • لا نحذف أي جدول أو بيانات أو مستخدم.
--   • لا نعدّل أي سياسة قائمة لم نُنشئها.
--   • نضيف سياسات additivive فقط (RLS يدمج السياسات بـ OR).
--   • مفاتيح الصلاحيات مطابقة تمامًا لـ MISAR_GM_SECTIONS في الواجهة.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) دالة: هل المدير العام يملك صلاحية قراءة المناديب فقط؟
--    المفتاح: delivery.view
--    القاعدة: تعيد true فقط إذا كان المطلوب صفًا من نوع delivery.
--    → المناديب فقط، وليس كل المستخدمين (كما طلب المؤسس).
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_gm_can_view_delivery()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.misar_is_founder()
    OR (
      public.misar_is_general_manager()
      AND COALESCE(
        (SELECT (s.setting_value::jsonb -> 'delivery' ->> 'view')::boolean
         FROM public.app_settings s
         WHERE s.setting_key = 'general_manager_permissions'),
        false
      )
    );
$$;

COMMENT ON FUNCTION public.misar_gm_can_view_delivery() IS
  'صلاحية قراءة قسم المناديب في لوحة المدير العام (delivery.view).';

-- ============================================================
-- 2) سياسة RLS جديدة على user_data — قراءة المناديب فقط
--    تُضاف (additive) فوق السياسات القائمة، لا تلغيها.
--    الشرط account_type = 'delivery' يمنع رؤية أي مستخدم آخر.
-- ============================================================
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_user_data_select_delivery_only" ON public.user_data;
CREATE POLICY "gm_user_data_select_delivery_only"
ON public.user_data
FOR SELECT
TO authenticated
USING (
  account_type = 'delivery'
  AND public.misar_gm_can_view_delivery()
);

-- ============================================================
-- 3) (اختياري) دالة قراءة قسم البائعين المستقل
--    المفتاح: sellers.view
--    ملاحظة: سياسة gm_user_data_select الحالية تمنح users.view قراءة
--    كل المستخدمين. إن أردت فصل البائعين عن العملاء عن المستخدمين،
--    نفّذ هذا القسم وعدّل السياسة الحالية (خارج نطاق هذه المسودة).
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_gm_can_view_sellers()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.misar_is_founder()
    OR (
      public.misar_is_general_manager()
      AND COALESCE(
        (SELECT (s.setting_value::jsonb -> 'sellers' ->> 'view')::boolean
         FROM public.app_settings s
         WHERE s.setting_key = 'general_manager_permissions'),
        false
      )
    );
$$;

DROP POLICY IF EXISTS "gm_user_data_select_sellers_only" ON public.user_data;
CREATE POLICY "gm_user_data_select_sellers_only"
ON public.user_data
FOR SELECT
TO authenticated
USING (
  account_type = 'seller'
  AND public.misar_gm_can_view_sellers()
);

-- ============================================================
-- 4) سياسة RLS على جدول services (موجود وفارغ حاليًا)
--    المفتاح: services.view
--    ملاحظة: الجدول فارغ، فالكود يعرض المصفوفة الثابتة كـ fallback.
--    هذه السياسة تمنع أي خطأ RLS إذا امتلأ الجدول مستقبلًا.
-- ============================================================
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_services_select" ON public.services;
CREATE POLICY "gm_services_select"
ON public.services
FOR SELECT
TO authenticated
USING (
  public.misar_is_founder()
  OR (
    public.misar_is_general_manager()
    AND COALESCE(
      (SELECT (s.setting_value::jsonb -> 'services' ->> 'view')::boolean
       FROM public.app_settings s
       WHERE s.setting_key = 'general_manager_permissions'),
      false
    )
  )
);

-- ============================================================
-- 5) (اختياري) توحيد سياسة الإعلانات: ads / banners
--    السياسة الحالية gm_banners_all تقبل ('banners' OR 'ads')،
--    وهذا يمنح إمكانية ازدواجية. لا نأمنها هنا — للتشخيص فقط.
--    راجع السؤال (ج) في التقرير.
-- ============================================================

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تشخيص بعد التنفيذ (SELECT فقط)
-- ============================================================
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND (policyname LIKE 'gm\_%' OR tablename = 'services')
ORDER BY tablename, policyname;

SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('misar_gm_can_view_delivery', 'misar_gm_can_view_sellers')
ORDER BY proname;
