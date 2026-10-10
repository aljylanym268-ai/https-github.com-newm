-- ============================================================
-- MISAR SYSTEMS — إصلاح عاجل: استعادة وصول المؤسس بعد اختفاء البيانات
-- ------------------------------------------------------------
-- السبب: سكربت general_manager_system.sql أعاد تعريف الدالة
--        public.misar_is_founder_or_admin() بحيث بقت تشمل
--        المؤسس + المدير العام فقط (وشال 'admin').
--        وبما أن كل سياسات SELECT/UPDATE على user_data تعتمد عليها،
--        المؤسس بطل يشوف غير صفه ⇒ "اتنين مستخدمين بس" والمناديب
--        والعملاء والبائعين اختفوا من اللوحة.
--
-- ملاحظة مهمة: لم يُحذف أي صف. هذا الملف لا يستخدم DROP TABLE
--              ولا TRUNCATE ولا DELETE على أي بيانات.
--
-- التنفيذ: Supabase Dashboard → SQL Editor (صلاحية مدير) → Run
-- ============================================================

BEGIN;

-- ============================================================
-- 1) إعادة دالة المؤسس/المدير للتوافق الكامل مع النظام القديم
--    - تشمل 'admin' القديم (توافق خلفي) + 'general_manager' النشط
--    - لا تعتمد على status للمؤسس (المؤسس لا يُوقَف).
--    - SECURITY DEFINER لمنع أي دورية RLS.
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
      AND u.account_type = 'founder'
  );
$$;

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

-- هذه هي الدالة الحاسمة: تشمل المؤسس + admin القديم + المدير العام.
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
-- 2) استعادة القراءة الكاملة للمؤسس/المدير على user_data
--    (سياسة واحدة واضحة، بدون الاعتماد على gm_can)
-- ============================================================
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founder_user_data_access" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

-- ============================================================
-- 3) استعادة الكتابة الكاملة للمؤسس/المدير على user_data
--    (تعديل الحالة: اعتماد/إيقاف مناديب وبائعين وعملاء)
-- ============================================================
DROP POLICY IF EXISTS "founder_user_data_write" ON public.user_data;
CREATE POLICY "founder_user_data_write"
ON public.user_data
FOR ALL
TO authenticated
USING (public.misar_is_founder_or_admin())
WITH CHECK (public.misar_is_founder_or_admin());

-- 3.b) ضمان أن كل مستخدم يقرأ صفّه هو دائماً (حتى لو تغيّرت أدواره).
--      سياسة إضافية لا تحذف أي شيء، ولا تكشف أي صف آخر.
DROP POLICY IF EXISTS "user_data_select_self" ON public.user_data;
CREATE POLICY "user_data_select_self"
ON public.user_data
FOR SELECT
TO authenticated
USING (id = (select auth.uid()));

-- ============================================================
-- 4) نفس الاستعادة لباقي الجداول اللي اتأثرت بالسياسات الجديدة
--    (إضافية/additive، بدون حذف أي سياسة أخرى).
--    محمية بـ DO block: لو جدول غير موجود يكمل بدون فشل.
-- ============================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['orders','products','returns','banners'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'founder_' || t || '_access', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.misar_is_founder_or_admin()) '
        'WITH CHECK (public.misar_is_founder_or_admin())',
        'founder_' || t || '_access', t
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 5) إصلاح Trigger حماية المؤسس
--    المشكلة: النسخة الحالية تشترط misar_is_founder() IS TRUE لأي تعديل،
--    وداخلها قراءة من user_data؛ وفي حالات كثيرة (auth.uid() غير موجود
--    أو صف المؤسس نفسه غير مقروء بسبب RLS) ترجع false فيمنع أي تعديل
--    حتى من المؤسس نفسه.
--    الإصلاح: نسمح بالتعديل دائماً، ونمنع فقط حالات التصعيد الحقيقية
--    لأي مستخدم مسجّل غير مؤسس (منع رفع account_type إلى founder).
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- لا نفرض أي قيد عند غياب سياق مستخدم (SQL Editor / Service Role).
  -- auth.uid() = NULL ⇒ عمليات الإدارة من الـ Dashboard أو السيرفر تمر بسلام.
  IF (select auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- منع التصعيد فقط: أي غير مؤسس لا يرقّي حساباً إلى founder.
  IF (public.misar_is_founder() IS NOT TRUE) THEN
    IF (TG_OP = 'INSERT' AND NEW.account_type = 'founder') THEN
      RAISE EXCEPTION 'غير مسموح: إنشاء حساب مؤسس يتطلب صلاحية المؤسس.';
    END IF;
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

-- إعادة بناء الـ trigger بنفس الاسم (بدون حذف بيانات).
DROP TRIGGER IF EXISTS misar_protect_founder_trigger ON public.user_data;
CREATE TRIGGER misar_protect_founder_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_protect_founder_row();

-- ============================================================
-- 6) تأكيد وجود مفاتيح إعدادات المدير العام (لا يلمس الموجود)
-- ============================================================
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES
  ('general_manager_suspended', '[]', now())
ON CONFLICT (setting_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تحقق نهائي: يجب أن ترى هنا صف المؤسس + كل المستخدمين في الاستعلام
-- التالي (نفّذه بعد COMMIT؛ الـ SQL Editor يتجاوز RLS فيرجع الكل).
-- ============================================================
SELECT account_type, count(*) AS cnt
FROM public.user_data
GROUP BY account_type
ORDER BY cnt DESC;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_data','orders','products','returns','banners')
  AND policyname LIKE 'founder\_%'
ORDER BY tablename, policyname;
