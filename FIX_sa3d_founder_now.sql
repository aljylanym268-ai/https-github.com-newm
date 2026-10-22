-- ============================================================
-- MISAR SYSTEMS — إصلاح فوري لحساب المؤسس
-- البريد: sa3dgelany@gmail.com
-- ------------------------------------------------------------
-- شغّل هذا الملف بالكامل في:
--   Supabase Dashboard → SQL Editor → Run
--
-- آمن تماماً: لا يحذف أي جدول ولا أي صف. يعدّل صفاً واحداً فقط
-- (صفك أنت) ويعيد بناء السياسات.
-- ============================================================

-- ============================================================
-- (0) قبل الإصلاح — شوف حالة حسابك الحالية
-- ============================================================
SELECT id, name, email, account_type, status
FROM public.user_data
WHERE lower(email) = 'sa3dgelany@gmail.com';

-- ============================================================
-- (1) الإصلاح البنيوي للدوال والسياسات
-- ============================================================
BEGIN;

-- دالة المدير العام (تُنشأ فقط إذا غير موجودة)
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

-- المؤسس: مؤسس أو admin القديم
CREATE OR REPLACE FUNCTION public.misar_is_founder()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type IN ('founder', 'admin')
  );
$$;

-- مؤسس أو admin قديم فقط؛ لا يمنح المدير العام وصول المؤسس.
CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.misar_is_founder();
$$;

-- سياسات user_data: المؤسس يقرأ ويكتب الكل + كل مستخدم يقرأ صفه
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

-- إصلاح trigger حماية المؤسس (كان يعطّل التعديلات)
CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF (select auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
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
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_protect_founder_trigger ON public.user_data;
CREATE TRIGGER misar_protect_founder_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_protect_founder_row();

-- ============================================================
-- (2) رفع صلاحية حسابك إلى founder (صف واحد فقط)
-- ============================================================
UPDATE public.user_data
SET account_type = 'founder',
    status = 'approved'
WHERE lower(email) = 'sa3dgelany@gmail.com';

-- لو الصف غير موجود أصلاً، أنشئه بالمعرّف من auth.users
INSERT INTO public.user_data (id, name, email, account_type, status)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  u.email,
  'founder',
  'approved'
FROM auth.users u
WHERE lower(u.email) = 'sa3dgelany@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.user_data d WHERE d.id = u.id);

-- ============================================================
-- (3) احتياطي: اضبط user_metadata أيضاً
--     (الكود يستخدمها لو تعذّرت قراءة user_data)
-- ============================================================
UPDATE auth.users
SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('account_type', 'founder', 'status', 'approved')
WHERE lower(email) = 'sa3dgelany@gmail.com';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- (4) بعد الإصلاح — تحقق: يجب أن يظهر founder و approved
-- ============================================================
SELECT id, name, email, account_type, status
FROM public.user_data
WHERE lower(email) = 'sa3dgelany@gmail.com';
