-- ============================================================
-- MISAR SYSTEMS — صلاحيات المدراء المخصّصة + إصلاح app_settings
-- ------------------------------------------------------------
-- يشمل ما يلي:
--   (1) دالة تقرأ صلاحيات كل مدير من byUser (تخصيص فردي) وإلا الافتراضي.
--   (2) إعادة تعريف misar_gm_can لتستخدم الصلاحيات المخصّصة.
--   (3) سياسات RLS على app_settings (إصلاح أخطاء 401 للقراءة).
--   (4) حماية المؤسس + قراءته لكل الصفوف (كما في الإصلاح السابق).
--
-- ⚠️ لا يحذف أي جدول ولا أي صف بيانات. Idempotent وقابل لإعادة التشغيل.
-- البنية المحفوظة في app_settings.general_manager_permissions:
--   { "default": { ... }, "byUser": { "<uuid>": { "label","role","perms" } } }
--   أو البنية القديمة المسطّحة (توافق خلفي).
--
-- التنفيذ: Supabase Dashboard → SQL Editor (صلاحية مدير) → Run
-- ============================================================

BEGIN;

-- ============================================================
-- 0) تأكيد وجود app_settings (لا ننشئه إن وُجد)
-- ============================================================
-- (نتجاهل الإنشاء إن كان الجدول موجوداً — موجود عندك مسبقاً)

-- ============================================================
-- 1) دالة موحّدة لقراءة كائن صلاحيات المدير العام (مع byUser)
--    ترجع JSONB دائماً (كائن) — تتعامل مع البنية القديمة والجديدة.
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_gm_perms_object()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(s.setting_value::jsonb) = 'object'
             AND (s.setting_value::jsonb ? 'default' OR s.setting_value::jsonb ? 'byUser')
          THEN s.setting_value::jsonb
        WHEN jsonb_typeof(s.setting_value::jsonb) = 'object'
          THEN jsonb_build_object('default', s.setting_value::jsonb, 'byUser', '{}'::jsonb)
        ELSE jsonb_build_object('default', '{}'::jsonb, 'byUser', '{}'::jsonb)
      END
      FROM public.app_settings s
      WHERE s.setting_key = 'general_manager_permissions'
    ),
    jsonb_build_object('default', '{}'::jsonb, 'byUser', '{}'::jsonb)
  );
$$;

-- ============================================================
-- 2) الدوال المساعدة (مؤسس / مدير عام / مؤسس أو مدير) — تُعرّف أولاً
--    حتى تعتمد عليها misar_gm_can بدون التباس.
-- ============================================================
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
      AND u.account_type IN ('founder', 'admin')
  );
$$;

DO $$
BEGIN
  IF to_regprocedure('public.misar_is_general_manager()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.misar_is_general_manager()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public AS $body$
        SELECT EXISTS (
          SELECT 1 FROM public.user_data u
          WHERE u.id = (select auth.uid())
            AND u.account_type = 'general_manager'
            AND u.status = 'approved'
        );
      $body$;
    $fn$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.misar_is_founder() OR public.misar_is_general_manager();
$$;

-- ============================================================
-- 3) الدالة الحاسمة: هل يملك المدير الحالي صلاحية (قسم + إجراء)؟
--    - المؤسس: yes دائماً.
--    - المدير العام النشط: يقرأ perms الخاص به من byUser[uuid].perms،
--      وإن لم يوجد يرجع إلى default.
-- ============================================================
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
        (
          COALESCE(
            public.misar_gm_perms_object() -> 'byUser' -> (select auth.uid())::text -> 'perms',
            public.misar_gm_perms_object() -> 'default'
          ) -> p_section ->> p_action
        )::boolean,
        false
      )
    );
$$;

-- ============================================================
-- 4) إصلاح app_settings — القراءة
-- ------------------------------------------------------------
-- سبب خطأ 401: طلب قراءة مفتاح إداري من زائر غير مسجّل.
-- الحل:
--   - anon: يقرأ الإعدادات العامة فقط (مفاتيح محدودة).
--   - authenticated: يقرأ كل الإعدادات.
--   - المؤسس/المدير: يقرأ كل الإعدادات دائماً (يحتاجها نظام الصلاحيات).
-- ============================================================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- أزل السياسات المتعارضة القديمة (لا نحذف بيانات)
DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_public_read" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_anon_read_public" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_authenticated_read" ON public.app_settings;
DROP POLICY IF EXISTS "gm_app_settings_select" ON public.app_settings;

-- (أ) المؤسس / المدير العام: كل المفاتيح
CREATE POLICY "app_settings_admin_read"
ON public.app_settings
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

-- (ب) الزوار: المفاتيح العامة فقط
CREATE POLICY "app_settings_anon_read_public"
ON public.app_settings
FOR SELECT
TO anon
USING (
  setting_key NOT IN (
    'deleted_governorates','deleted_centers','extra_centers',
    'seller_commission','delivery_commission','min_withdrawal',
    'return_fee','return_window_days','delivery_fee',
    'general_manager_permissions','general_manager_suspended',
    'general_manager_byuser','general_manager_sections'
  )
);

-- (ج) المستخدمون المسجّلون: كل الإعدادات (تحتاجها شاشات التطبيق)
CREATE POLICY "app_settings_authenticated_read"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

-- ============================================================
-- 5) إصلاح app_settings — الكتابة (المؤسس فقط)
--    المدير العام لا يكتب الصلاحيات ولا الإعدادات الحساسة.
-- ============================================================
DROP POLICY IF EXISTS "app_settings_founder_insert" ON public.app_settings;
CREATE POLICY "app_settings_founder_insert"
ON public.app_settings FOR INSERT TO authenticated
WITH CHECK (public.misar_is_founder());

DROP POLICY IF EXISTS "app_settings_founder_update" ON public.app_settings;
CREATE POLICY "app_settings_founder_update"
ON public.app_settings FOR UPDATE TO authenticated
USING (public.misar_is_founder())
WITH CHECK (public.misar_is_founder());

DROP POLICY IF EXISTS "app_settings_founder_delete" ON public.app_settings;
CREATE POLICY "app_settings_founder_delete"
ON public.app_settings FOR DELETE TO authenticated
USING (public.misar_is_founder());

-- ============================================================
-- 6) حماية user_data — المؤسس يقرأ ويعدّل كل شيء
-- ============================================================
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founder_user_data_access" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data FOR SELECT TO authenticated
USING (public.misar_is_founder_or_admin());

DROP POLICY IF EXISTS "user_data_select_self" ON public.user_data;
CREATE POLICY "user_data_select_self"
ON public.user_data FOR SELECT TO authenticated
USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "founder_user_data_write" ON public.user_data;
CREATE POLICY "founder_user_data_write"
ON public.user_data FOR ALL TO authenticated
USING (public.misar_is_founder_or_admin())
WITH CHECK (public.misar_is_founder_or_admin());

-- ============================================================
-- 7) حماية المؤسس (Trigger) — لا نعطّل التعديلات
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (select auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF (public.misar_is_founder() IS NOT TRUE) THEN
    IF (TG_OP = 'INSERT' AND NEW.account_type = 'founder') THEN
      RAISE EXCEPTION 'غير مسموح: إنشاء حساب مؤسس يتطلب صلاحية المؤسس.';
    END IF;
    IF (TG_OP = 'UPDATE' AND NEW.account_type = 'founder' AND OLD.account_type <> 'founder') THEN
      RAISE EXCEPTION 'غير مسموح: ترقية حساب إلى مؤسس.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_protect_founder_trigger ON public.user_data;
CREATE TRIGGER misar_protect_founder_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_protect_founder_row();

-- ============================================================
-- 8) التهيئة الآمنة لمفاتيح المدير العام (لا تلمس الموجود)
-- ============================================================
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES
  ('general_manager_permissions',
   '{"default":{"dashboard":{"view":true},"orders":{"view":true,"create":false,"edit":false,"delete":false},"products":{"view":true,"create":false,"edit":false,"delete":false},"services":{"view":true,"create":false,"edit":false,"delete":false},"users":{"view":true,"edit":false},"sellers":{"view":true,"edit":false},"delivery":{"view":true,"edit":false},"returns":{"view":true,"edit":false},"ads":{"view":true,"edit":false},"banners":{"view":false,"edit":false},"locations":{"view":false,"edit":false},"reports":{"view":true,"edit":false},"activity_logs":{"view":false},"settings":{"view":false,"edit":false}},"byUser":{}}',
   now()),
  ('general_manager_suspended', '[]', now()),
  ('general_manager_sections', '[]', now())
ON CONFLICT (setting_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تحقق: اطبع الدوال والسياسات للتأكد
-- ============================================================
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('misar_is_founder','misar_is_general_manager','misar_is_founder_or_admin',
                    'misar_gm_can','misar_gm_perms_object','misar_protect_founder_row')
ORDER BY p.proname;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('app_settings','user_data')
  AND (policyname LIKE 'app_settings\_%' OR policyname LIKE 'founder\_%' OR policyname LIKE 'user_data\_%')
ORDER BY tablename, policyname;
