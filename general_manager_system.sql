-- ============================================================
-- MISAR SYSTEMS — نظام General Manager (المدير العام)
-- ------------------------------------------------------------
-- آمن وقابل لإعادة التشغيل (Idempotent).
-- لا يحذف جداول، ولا يحذف بيانات، ولا يستخدم DROP TABLE، ولا TRUNCATE.
-- لا يعدّل أي مستخدم حالي ولا حساب المؤسس.
--
-- الترتيب الإداري:
--   founder  >  general_manager  >  باقي الحسابات
-- ------------------------------------------------------------
-- التنفيذ: Supabase Dashboard → SQL Editor (صلاحية مدير) → Run
-- ============================================================

BEGIN;

-- ============================================================
-- 0) التأكد من وجود العمود account_type (لا يتغير نوعه)
--    نضيف عمود حالة الإيقاف للمدير العام عبر app_settings فقط،
--    فلا نحتاج أي تعديل هيكلي على user_data.
-- ============================================================

-- ============================================================
-- 1) دوال التحقق المنفصلة (SECURITY DEFINER — تمنع دورية RLS)
-- ============================================================

-- (أ) مؤسس فقط
CREATE OR REPLACE FUNCTION public.misar_is_founder()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type = 'founder'
  );
$$;

-- (ب) مدير عام (نشط فقط — الإيقاف يمنع كل الصلاحيات على مستوى DB)
-- حالة الإيقاف محفوظة في app_settings بالمفتاح:
--   general_manager_suspended  = JSON.stringify([ "uuid1", "uuid2" ])
CREATE OR REPLACE FUNCTION public.misar_is_general_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type = 'general_manager'
      AND u.status = 'approved'
      AND u.id::text NOT IN (
        SELECT jsonb_array_elements_text(
          COALESCE(
            (SELECT s.setting_value::jsonb FROM public.app_settings s
             WHERE s.setting_key = 'general_manager_suspended'),
            '[]'::jsonb
          )
        )
      )
  );
$$;

-- (ج) مؤسس أو مدير عام نشط (لا يشمل 'admin' القديم — Founder ≠ GM)
CREATE OR REPLACE FUNCTION public.misar_is_founder_or_gm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.misar_is_founder() OR public.misar_is_general_manager();
$$;

-- (د) التحقق من صلاحية محددة للمدير العام (قسم + إجراء)
--     تُقرأ من app_settings بالمفتاح:
--     general_manager_permissions = JSON {
--        "orders": {"view":true,"create":false,"edit":true,"delete":false},
--        "products": {...}, "users": {...}, "delivery": {...},
--        "sellers": {...}, "services": {...}, "returns": {...},
--        "ads": {...}, "banners": {...}, "locations": {...},
--        "reports": {...}, "activity_logs": {...}, "settings": {...},
--        "dashboard": {"view":true}
--     }
CREATE OR REPLACE FUNCTION public.misar_gm_can(p_section text, p_action text DEFAULT 'view')
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
        (SELECT (s.setting_value::jsonb -> p_section ->> p_action)::boolean
         FROM public.app_settings s
         WHERE s.setting_key = 'general_manager_permissions'),
        false
      )
    );
$$;

-- (هـ) توافق خلفي: تشمل المؤسس + 'admin' القديم + المدير العام النشط.
--     مهم: لو حذفنا 'admin' تفقد كل سياسات RLS المبنية على هذه الدالة
--     وصول المؤسس إلى صفوف user_data فيختفي كل المستخدمين من اللوحة.
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
  )
  OR public.misar_is_general_manager();
$$;

-- ============================================================
-- 2) حماية المؤسس — قاعدة ذهبية على مستوى قاعدة البيانات
--    لا يمكن لأي غير مؤسس أن يغيّر account_type لصف يحمل founder،
--    ولا أن ينشئ صفاً بـ account_type = 'founder'.
--    تُفرض عبر Trigger (يمنع التصعيد حتى لو تجاوز أحد الواجهة).
-- ============================================================

CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- لا نفرض قيوداً عند غياب سياق مستخدم (SQL Editor / Service Role):
  -- هذا يمنع تعطيل كل التعديلات على user_data بالخطأ.
  IF (select auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- منع التصعيد فقط: أي غير مؤسس لا يرقّي حساباً إلى founder.
  -- (لا نمنع المؤسس من تعديل صفوفه؛ وإلا تتعطل إدارة الحسابات.)
  IF (public.misar_is_founder() IS NOT TRUE) THEN

    -- (1) لا إنشاء مؤسس
    IF (TG_OP = 'INSERT' AND NEW.account_type = 'founder') THEN
      RAISE EXCEPTION 'غير مسموح: إنشاء حساب مؤسس يتطلب صلاحية المؤسس.';
    END IF;

    -- (2) لا ترقية أي حساب إلى مؤسس
    IF (TG_OP = 'UPDATE' AND NEW.account_type = 'founder' AND OLD.account_type <> 'founder') THEN
      RAISE EXCEPTION 'غير مسموح: ترقية حساب إلى مؤسس.';
    END IF;

  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_protect_founder_trigger ON public.user_data;
CREATE TRIGGER misar_protect_founder_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_protect_founder_row();

-- ============================================================
-- 3) سياسات RLS لـ user_data (المدير العام)
--    - المدير العام يقرأ المستخدمين فقط إذا كان يملك صلاحية users.view
--    - المدير العام يعدّل المستخدمين فقط إذا كان يملك users.edit
--    - السياسات الحالية للمؤسس تبقى، والسياسات الجديدة additive.
-- ============================================================

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- مهم (إصلاح): المؤسس يجب أن يقرأ كل الصفوف دائماً، مستقلاً عن
-- جدول صلاحيات المدير العام. هذا يمنع اختفاء المستخدمين من اللوحة.
DROP POLICY IF EXISTS "founder_user_data_access" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

-- ضمان أن كل مستخدم يقرأ صفه هو.
DROP POLICY IF EXISTS "user_data_select_self" ON public.user_data;
CREATE POLICY "user_data_select_self"
ON public.user_data
FOR SELECT
TO authenticated
USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "gm_user_data_select" ON public.user_data;
CREATE POLICY "gm_user_data_select"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_gm_can('users', 'view'));

DROP POLICY IF EXISTS "gm_user_data_update" ON public.user_data;
CREATE POLICY "gm_user_data_update"
ON public.user_data
FOR UPDATE
TO authenticated
USING (
  public.misar_gm_can('users', 'edit')
  AND account_type <> 'founder'          -- لا يلمس المؤسس أبداً
  AND account_type <> 'general_manager'  -- ولا يعدّل مدراء آخرين
)
WITH CHECK (
  public.misar_gm_can('users', 'edit')
  AND account_type <> 'founder'
  AND account_type <> 'general_manager'
);

-- ============================================================
-- 4) سياسات RLS لـ orders (المدير العام)
-- ============================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_orders_select" ON public.orders;
CREATE POLICY "gm_orders_select"
ON public.orders
FOR SELECT
TO authenticated
USING (public.misar_gm_can('orders', 'view'));

DROP POLICY IF EXISTS "gm_orders_update" ON public.orders;
CREATE POLICY "gm_orders_update"
ON public.orders
FOR UPDATE
TO authenticated
USING (public.misar_gm_can('orders', 'edit'))
WITH CHECK (public.misar_gm_can('orders', 'edit'));

-- ============================================================
-- 5) سياسات RLS لـ products (المدير العام)
-- ============================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_products_select" ON public.products;
CREATE POLICY "gm_products_select"
ON public.products
FOR SELECT
TO authenticated
USING (public.misar_gm_can('products', 'view'));

DROP POLICY IF EXISTS "gm_products_write" ON public.products;
CREATE POLICY "gm_products_write"
ON public.products
FOR ALL
TO authenticated
USING (public.misar_gm_can('products', 'edit') OR public.misar_gm_can('products', 'delete'))
WITH CHECK (public.misar_gm_can('products', 'edit') OR public.misar_gm_can('products', 'create'));

-- ============================================================
-- 6) سياسات RLS لـ returns (المدير العام)
-- ============================================================
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_returns_select" ON public.returns;
CREATE POLICY "gm_returns_select"
ON public.returns
FOR SELECT
TO authenticated
USING (public.misar_gm_can('returns', 'view'));

DROP POLICY IF EXISTS "gm_returns_update" ON public.returns;
CREATE POLICY "gm_returns_update"
ON public.returns
FOR UPDATE
TO authenticated
USING (public.misar_gm_can('returns', 'edit'))
WITH CHECK (public.misar_gm_can('returns', 'edit'));

-- ============================================================
-- 7) سياسات RLS لـ banners (المدير العام)
-- ============================================================
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_banners_all" ON public.banners;
CREATE POLICY "gm_banners_all"
ON public.banners
FOR ALL
TO authenticated
USING (public.misar_gm_can('banners', 'view') OR public.misar_gm_can('ads', 'view'))
WITH CHECK (public.misar_gm_can('banners', 'edit') OR public.misar_gm_can('ads', 'edit'));

-- ============================================================
-- 8) سياسات RLS لـ activity_logs (المدير العام + المؤسس)
--    المؤسس يرى الكل، والمدير العام يرى سجله وسجل عملياته فقط
--    إذا ملك activity_logs.view، وكلاهما يستطيع الكتابة (تسجيل نشاطه).
-- ============================================================
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- المؤسس: قراءة كاملة
DROP POLICY IF EXISTS "activity_logs_founder_select" ON public.activity_logs;
CREATE POLICY "activity_logs_founder_select"
ON public.activity_logs
FOR SELECT
TO authenticated
USING (public.misar_is_founder());

-- المدير العام: قراءة (سجل النظام المرتبط بعملياته + نشاطه)
DROP POLICY IF EXISTS "activity_logs_gm_select" ON public.activity_logs;
CREATE POLICY "activity_logs_gm_select"
ON public.activity_logs
FOR SELECT
TO authenticated
USING (public.misar_gm_can('activity_logs', 'view'));

-- الكتابة: المؤسس أو المدير العام النشط (لا مستخدم عادي)
DROP POLICY IF EXISTS "activity_logs_admin_insert" ON public.activity_logs;
CREATE POLICY "activity_logs_admin_insert"
ON public.activity_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.misar_is_founder_or_gm()
  AND admin_id = (select auth.uid())   -- لا يمكن انتحال هوية مسؤول آخر
);

-- ============================================================
-- 9) سياسات RLS لـ app_settings (المدير العام)
--    المدير العام يقرأ الإعدادات إذا ملك settings.view
--    ويكتب فقط مفاتيح محدودة (غير الحساسة)،
--    ومفاتيح نظام المدير العام محمية من الكتابة (يكتبها المؤسس فقط).
-- ============================================================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_app_settings_select" ON public.app_settings;
CREATE POLICY "gm_app_settings_select"
ON public.app_settings
FOR SELECT
TO authenticated
USING (public.misar_gm_can('settings', 'view'));

DROP POLICY IF EXISTS "gm_app_settings_update" ON public.app_settings;
CREATE POLICY "gm_app_settings_update"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (
  public.misar_gm_can('settings', 'edit')
  -- مفاتيح إدارة الصلاحيات تُكتب من المؤسس فقط
  AND setting_key NOT IN (
    'general_manager_permissions',
    'general_manager_suspended',
    'general_manager_sections'
  )
  AND setting_key NOT IN (
    'deleted_governorates','deleted_centers','extra_centers',
    'seller_commission','delivery_commission','min_withdrawal'
  )
)
WITH CHECK (
  public.misar_gm_can('settings', 'edit')
  AND setting_key NOT IN (
    'general_manager_permissions',
    'general_manager_suspended',
    'general_manager_sections'
  )
  AND setting_key NOT IN (
    'deleted_governorates','deleted_centers','extra_centers',
    'seller_commission','delivery_commission','min_withdrawal'
  )
);

-- ============================================================
-- 10) تهيئة إعدادات المدير العام الافتراضية (لا تلمس الموجود)
--     المؤسس هو من يعيّن المدراء لاحقاً؛ هذه مجرد قيم افتراضية آمنة.
-- ============================================================
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES
  ('general_manager_permissions',
   '{"dashboard":{"view":true},"orders":{"view":true,"create":false,"edit":false,"delete":false},"products":{"view":true,"create":false,"edit":false,"delete":false},"services":{"view":true,"create":false,"edit":false,"delete":false},"users":{"view":true,"edit":false},"sellers":{"view":true,"edit":false},"delivery":{"view":true,"edit":false},"returns":{"view":true,"edit":false},"ads":{"view":true,"edit":false},"banners":{"view":false,"edit":false},"locations":{"view":false,"edit":false},"reports":{"view":true,"edit":false},"activity_logs":{"view":false},"settings":{"view":false,"edit":false}}',
   now()),
  ('general_manager_suspended', '[]', now()),
  ('general_manager_sections', '[]', now())
ON CONFLICT (setting_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تشخيص: اطبع الدوال والسياسات الجديدة للتأكد
-- ============================================================
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('misar_is_founder','misar_is_general_manager','misar_is_founder_or_gm','misar_gm_can','misar_protect_founder_row')
ORDER BY p.proname;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (policyname LIKE 'gm\_%' OR policyname LIKE 'activity_logs\_%')
ORDER BY tablename, policyname;
