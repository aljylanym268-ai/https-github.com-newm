-- ============================================================
-- MISAR TECH — إنشاء جدول طلبات المشاريع + سياسات RLS
-- ------------------------------------------------------------
-- يُنفَّذ مرة واحدة في Supabase SQL Editor.
-- لا يعدّل أي جدول أو سياسة موجودة — إنشاء فقط.
-- ============================================================

-- 1) الجدول
CREATE TABLE IF NOT EXISTS public.misar_tech_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- معرف العميل المسجل إن وُجد
    client_name     text NOT NULL,
    client_contact  text NOT NULL,
    project_type    text NOT NULL CHECK (project_type IN
                        ('website','store','mobile_app','business_system','ai_automation','other')),
    project_title   text NOT NULL,
    project_brief   text NOT NULL,
    budget          text,
    deadline        text,
    extra_notes     text,
    status          text NOT NULL DEFAULT 'new' CHECK (status IN
                        ('new','reviewing','quoted','in_progress','delivered','cancelled')),
    quoted_price    numeric(12,2),
    admin_notes     text,
    updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),   -- تاريخ الإنشاء من الخادم
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- منع تكرار الطلب بنفس المحتوى من نفس المستخدم خلال دقيقة (حماية إضافية من الإرسال المتكرر)
CREATE UNIQUE INDEX IF NOT EXISTS misar_tech_requests_no_dupes
    ON public.misar_tech_requests (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                   client_name, client_contact, project_title, (created_at AT TIME ZONE 'utc')::date);

-- 2) تفعيل RLS
ALTER TABLE public.misar_tech_requests ENABLE ROW LEVEL SECURITY;

-- 3) تحديد "فريق الإدارة" = المؤسس أو مدير عام بترخيص misar_tech:view/edit
--    (يقرأ من user_data.account_type و app_settings.general_manager_permissions — نفس النظام الحالي)
CREATE OR REPLACE FUNCTION public.misar_tech_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_data
        WHERE user_data.user_id = auth.uid()
          AND (
              user_data.account_type = 'founder'
              OR (
                  user_data.account_type = 'general_manager'
                  AND (
                      (app_settings.general_manager_permissions::jsonb #>> '{misar_tech,view}')::boolean IS TRUE
                      OR (app_settings.general_manager_permissions::jsonb #>> '{misar_tech,edit}')::boolean IS TRUE
                  )
              )
          )
    );
$$;

-- 4) السياسات
--    الكتابة: العميل مسجل الدخول يُدخل طلبًا بنفسه فقط (أو زائر بدون user_id).
DROP POLICY IF EXISTS mt_insert_own ON public.misar_tech_requests;
CREATE POLICY mt_insert_own ON public.misar_tech_requests
    FOR INSERT TO authenticated
    WITH CHECK (user_id IS NULL OR user_id = auth.uid());

--    القراءة: العميل يرى طلباته فقط، والإدارة ترى الكل. الزائر (anon) لا يقرأ شيئًا.
DROP POLICY IF EXISTS mt_select_own_or_admin ON public.misar_tech_requests;
CREATE POLICY mt_select_own_or_admin ON public.misar_tech_requests
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.misar_tech_is_admin());

--    التعديل: الإدارة فقط (المؤسس أو مدير عام مرخّص misar_tech:edit). العميل لا يعدّل بيانات الإدارة.
DROP POLICY IF EXISTS mt_update_admin ON public.misar_tech_requests;
CREATE POLICY mt_update_admin ON public.misar_tech_requests
    FOR UPDATE TO authenticated
    USING (public.misar_tech_is_admin())
    WITH CHECK (public.misar_tech_is_admin());

--    لا سياسة DELETE لأي دور — الطلب لا يُحذف من الواجهة أبدًا.

-- 5) تحديث updated_at تلقائيًا (فقط إذا لم تكن موجودة هذه الدالة العامة)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at' AND pronamespace = 'public'::regnamespace) THEN
        CREATE FUNCTION public.handle_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$;
        CREATE TRIGGER misar_tech_requests_updated_at
            BEFORE UPDATE ON public.misar_tech_requests
            FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    ELSE
        CREATE TRIGGER misar_tech_requests_updated_at
            BEFORE UPDATE ON public.misar_tech_requests
            FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    END IF;
END $$;

-- 6) إعادة تحميل مخطط PostgREST حتى تتعرف الواجهة على الجدول فورًا
NOTIFY pgrst, 'reload schema';
