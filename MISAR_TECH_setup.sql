-- ============================================================
-- MISAR TECH — جدول طلبات المشاريع + RLS
-- المؤسس هو المتحكم الأول والأخير:
--   - صلاحية كاملة (FOR ALL) للمؤسس
--   - المدير العام: عرض فقط افتراضيًا، والتعديل فقط بمنح صريح من المؤسس
--     عبر misar_gm_can('misar_tech','edit')
-- لا يعدّل أي جدول أو سياسة قائمة.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.misar_tech_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NULL REFERENCES public.user_data(id) ON DELETE SET NULL,
  client_name     text NOT NULL,
  client_contact  text NOT NULL,
  project_type    text NOT NULL,
  project_title   text NOT NULL,
  project_brief   text NOT NULL,
  budget          text NULL,
  deadline        text NULL,
  notes           text NULL,
  status          text NOT NULL DEFAULT 'new',
  quoted_price    text NULL,
  admin_notes     text NULL,
  updated_by      uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.misar_tech_requests ENABLE ROW LEVEL SECURITY;

-- العميل: ينشئ طلبًا باسمه فقط (client_id = auth.uid())
DROP POLICY IF EXISTS "mt_client_insert_own" ON public.misar_tech_requests;
CREATE POLICY "mt_client_insert_own"
ON public.misar_tech_requests FOR INSERT TO authenticated
WITH CHECK (client_id = auth.uid());

-- العميل: يقرأ طلباته فقط
DROP POLICY IF EXISTS "mt_client_select_own" ON public.misar_tech_requests;
CREATE POLICY "mt_client_select_own"
ON public.misar_tech_requests FOR SELECT TO authenticated
USING (client_id = auth.uid());

-- المؤسس: صلاحية كاملة
DROP POLICY IF EXISTS "mt_founder_all" ON public.misar_tech_requests;
CREATE POLICY "mt_founder_all"
ON public.misar_tech_requests FOR ALL TO authenticated
USING (public.misar_is_founder())
WITH CHECK (public.misar_is_founder());

-- المدير العام: عرض حسب الصلاحية
DROP POLICY IF EXISTS "mt_gm_select" ON public.misar_tech_requests;
CREATE POLICY "mt_gm_select"
ON public.misar_tech_requests FOR SELECT TO authenticated
USING (public.misar_gm_can('misar_tech', 'view'));

-- المدير العام: تعديل حسب الصلاحية (يُمنح من المؤسس فقط)
DROP POLICY IF EXISTS "mt_gm_update" ON public.misar_tech_requests;
CREATE POLICY "mt_gm_update"
ON public.misar_tech_requests FOR UPDATE TO authenticated
USING (public.misar_gm_can('misar_tech', 'edit'))
WITH CHECK (public.misar_gm_can('misar_tech', 'edit'));

-- تحديث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION public.misar_tech_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_misar_tech_touch ON public.misar_tech_requests;
CREATE TRIGGER trg_misar_tech_touch
BEFORE UPDATE ON public.misar_tech_requests
FOR EACH ROW EXECUTE FUNCTION public.misar_tech_touch();

-- قسم misar_tech في الصلاحيات الافتراضية (عرض فقط للمدير العام)
UPDATE public.app_settings
SET setting_value = jsonb_set(
  COALESCE(setting_value::jsonb, '{}'::jsonb),
  '{default,misar_tech}',
  '{"view": true, "edit": false}'::jsonb,
  true)
WHERE setting_key = 'general_manager_permissions';

-- تحقق (اختياري): إظهار السياسات والصلاحيات المطبقة
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'misar_tech_requests';
