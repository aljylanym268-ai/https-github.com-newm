-- ============================================================
-- MISAR SYSTEMS — إصلاح: لوحة المؤسس مش ظاهرة
-- ------------------------------------------------------------
-- السبب في الواجهة: عنصر "لوحة تحكم المؤسس" مخفي بـ display:none،
-- ويظهر فقط إذا (appState.userData.account_type === 'founder').
-- وبالتالي أي خلل في صف المؤسس داخل user_data يخفي اللوحة تماماً.
--
-- ملاحظة: لم يُحذف أي صف. لا DROP TABLE ولا TRUNCATE ولا DELETE.
--
-- التنفيذ: Supabase Dashboard → SQL Editor (صلاحية مدير) → Run
-- ============================================================

-- ============================================================
-- الخطوة 1) تشخيص: اطبع كل حساب founder / admin / general_manager
--           وحالة RLS الخاصة به، وعدد الصفوف الكلي.
-- ============================================================
SELECT id, name, email, account_type, status, created_at
FROM public.user_data
WHERE account_type IN ('founder', 'admin', 'general_manager')
ORDER BY account_type, created_at;

-- كم مستخدم إجمالاً (يتجاوز RLS لأن SQL Editor يشتغل بـ service_role)
SELECT account_type, count(*) AS cnt
FROM public.user_data
GROUP BY account_type
ORDER BY cnt DESC;

-- ============================================================
-- الخطوة 2) إذا ظهر أن بريدك في user_data عليه account_type
--           مختلف عن 'founder' — صحّحه يدوياً قبل متابعة الخطوة 3.
--           ضع بريدك الحقيقي مكان  YOUR_EMAIL@example.com
-- ------------------------------------------------------------
-- UPDATE public.user_data
-- SET account_type = 'founder', status = 'approved'
-- WHERE email = 'YOUR_EMAIL@example.com';
-- ============================================================

-- ============================================================
-- الخطوة 3) الإصلاح البنيوي:
--   (أ) ضمان أن سياسات قراءة user_data تسمح للمؤسس دائماً.
--   (ب) إصلاح trigger حماية المؤسس حتى لا يعطّل التعديلات.
--   (ج) إصلاح دالة التوافق الخلفي لتشمل 'admin'.
-- ============================================================
BEGIN;

-- (أ) --- دوال التحقق -----------------------------------------
-- نضمن وجود misar_is_general_manager لأن misar_is_founder_or_admin تعتمد عليها.
-- (لن تحذف النسخة الأحدث المعرَّفة في general_manager_system.sql عند وجودها).
DO $$
BEGIN
  IF to_regprocedure('public.misar_is_general_manager()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.misar_is_general_manager()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
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
      $body$;
    $fn$;
  END IF;
END $$;

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

CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.misar_is_founder();
$$;

-- (ب) --- سياسات قراءة/كتابة user_data للمؤسس ---------------
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founder_user_data_access" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

DROP POLICY IF EXISTS "user_data_select_self" ON public.user_data;
CREATE POLICY "user_data_select_self"
ON public.user_data
FOR SELECT
TO authenticated
USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "founder_user_data_write" ON public.user_data;
CREATE POLICY "founder_user_data_write"
ON public.user_data
FOR ALL
TO authenticated
USING (public.misar_is_founder_or_admin())
WITH CHECK (public.misar_is_founder_or_admin());

-- (ج) --- إصلاح trigger حماية المؤسس -------------------------
CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- لا قيود عند غياب سياق مستخدم (SQL Editor / Service Role).
  IF (select auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Only the founder may change account roles or approval status.
  IF (public.misar_is_founder() IS NOT TRUE) THEN
    IF TG_OP = 'INSERT' AND NEW.account_type IN ('founder', 'general_manager', 'admin') THEN
      RAISE EXCEPTION 'غير مسموح: تعيين دور مميز يتطلب صلاحية المؤسس.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.account_type IS DISTINCT FROM OLD.account_type THEN
      RAISE EXCEPTION 'غير مسموح: تغيير دور الحساب يتطلب صلاحية المؤسس.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'غير مسموح: تغيير حالة الاعتماد يتطلب صلاحية المؤسس.';
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

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- الخطوة 4) تأمين الاحتياطي في user_metadata
-- ------------------------------------------------------------
-- الواجهة (js/supabase.js → loadUserData) لو فشلت في قراءة صفك
-- من user_data لسبب RLS، تستخدم user_metadata.account_type كبديل.
-- لو القيمة هناك 'client' تفضل اللوحة مخفية. لذلك نضبطها.
--
-- اضبط بريدك الحقيقي مكان YOUR_EMAIL@example.com ثم شغّل:
-- ============================================================
-- UPDATE auth.users
-- SET raw_user_meta_data =
--       coalesce(raw_user_meta_data, '{}'::jsonb)
--       || jsonb_build_object('account_type', 'founder', 'status', 'approved')
-- WHERE email = 'YOUR_EMAIL@example.com';

-- اطبع الحالة الحالية لكل حسابات المؤسس في auth.users
SELECT
  u.id,
  u.email,
  u.raw_user_meta_data ->> 'account_type' AS meta_account_type,
  u.raw_user_meta_data ->> 'status'       AS meta_status,
  d.account_type                          AS db_account_type,
  d.status                                AS db_status
FROM auth.users u
LEFT JOIN public.user_data d ON d.id = u.id
WHERE d.account_type IN ('founder', 'admin', 'general_manager')
   OR u.raw_user_meta_data ->> 'account_type' IN ('founder', 'admin', 'general_manager')
ORDER BY u.email;

-- ============================================================
-- الخطوة 5) تحقق نهائي — يجب أن يظهر هنا حسابك كـ founder.
-- ============================================================
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_data'
ORDER BY policyname;
