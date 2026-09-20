-- MISAR SYSTEMS
-- إصلاح مشكلة "الإيقاف/الاعتماد الوهمي" من صفحة المؤسسة.
--
-- السبب: سياسة user_data_select للمؤس كانت SELECT فقط، لذلك UPDATE على صف
-- مندوب/بائع/عميل يُرجع صفر صفوف بدون خطأ، فتظهر رسالة نجاح والحالة لا تتغير.
--
-- هذا الملف يضيف صلاحية كتابة للمؤس/المدير فقط، بدون فتح قراءة عامة.
-- شغّله من Supabase SQL Editor بصلاحية مدير.

BEGIN;

-- يجب أن تكون الدالة موجودة من الملف السابق:
-- repair_misar_orders_rls_and_seller_snapshot.sql
-- إن لم تكن موجودة، هذا التعريف يعيدها بأمان.
CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type IN ('founder', 'admin')
  );
$$;

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- سياسة الكتابة للمؤس فقط (SELECT/INSERT/UPDATE/DELETE).
-- USING تتحكم بالصفوف المقروءة/المعدلة، وWITH CHECK تتحكم بالصفوف الجديدة.
DROP POLICY IF EXISTS "founder_user_data_write" ON public.user_data;
CREATE POLICY "founder_user_data_write"
ON public.user_data
FOR ALL
TO authenticated
USING (public.misar_is_founder_or_admin())
WITH CHECK (public.misar_is_founder_or_admin());

-- التأكد أن سياسة القراءة للمؤس موجودة (من الملف السابق).
DROP POLICY IF EXISTS "founder_user_data_access" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تحقق: يجب أن تظهر سياسات القراءة والكتابة للمؤس
-- ============================================================
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_data'
ORDER BY policyname;

-- ============================================================
-- اختبار فعلي (نفّذه وأنت مسجل كمؤس في SQL Editor مع auth.uid())
-- استبدل <DELIVERY_UUID> بمعرّف مندوب حقي من جدول user_data.
-- يجب أن يرجع صفاً واحداً بعد التغيير.
-- ============================================================
-- SELECT id, name, account_type, status
-- FROM public.user_data
-- WHERE account_type = 'delivery'
-- ORDER BY created_at DESC
-- LIMIT 5;
