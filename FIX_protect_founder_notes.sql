-- ============================================================
-- MISAR SYSTEMS — حماية مفتاح ملاحظات المؤسس
-- FIX_protect_founder_notes.sql
-- ============================================================
-- الغرض:
--   حماية مفتاح founder_notes_v1 (ملاحظات المؤسس) من الكتابة
--   أو الحذف من المدير العام على مستوى RLS، بحيث:
--   • المؤسس فقط يكتبها/يحذفها.
--   • المدير العام يقرأها فقط (لوحة الملاحظات عند المدير قراءة).
--
-- نقطة مهمة: سياسة gm_app_settings_update الحالية تستخدم قائمة
-- ثابتة (NOT IN ...) ولا تستدعي دالة الحماية — لذلك هذه الإصلاحة
-- تعيد تعريف السياسة لتستخدم الدالة misar_app_settings_is_protected_key
-- وتضيف founder_notes_v1 إليها. بهذا أي مفتاح يُضاف مستقبلاً
-- للدالة يصبح محمياً تلقائياً بدون تعديل السياسات.
--
-- آمن 100%: Idempotent — يمكن تشغيله أكثر من مرة.
-- التنفيذ: مرة واحدة في Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) تحديث قائمة المفاتيح المحمية (إضافة founder_notes_v1)
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_app_settings_is_protected_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_key IN (
    'notification_settings',
    'founder_whatsapp_number',
    'founder_settings',
    'founder_notes_v1',
    'general_manager_permissions',
    'general_manager_suspended',
    'general_manager_sections'
  );
$$;

-- ============================================================
-- 2) إعادة تعريف سياسة المدير العام لتستخدم الدالة
--    (قبل التعديل: قائمة ثابتة لا تشمل founder_notes_v1 —
--     كان المدير يستطيع تعديل/حذف الملاحظات رغم الدالة!)
-- ============================================================
DROP POLICY IF EXISTS "gm_app_settings_update" ON public.app_settings;
CREATE POLICY "gm_app_settings_update"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (
  public.misar_gm_can('settings', 'edit')
  -- كل المفاتيح المحمية تُكتب من المؤسس فقط
  AND NOT public.misar_app_settings_is_protected_key(setting_key)
  AND setting_key NOT IN (
    'deleted_governorates','deleted_centers','extra_centers',
    'seller_commission','delivery_commission','min_withdrawal'
  )
)
WITH CHECK (
  public.misar_gm_can('settings', 'edit')
  AND NOT public.misar_app_settings_is_protected_key(setting_key)
  AND setting_key NOT IN (
    'deleted_governorates','deleted_centers','extra_centers',
    'seller_commission','delivery_commission','min_withdrawal'
  )
);

-- ============================================================
-- 3) سياسة المؤسس: كتابة كل شيء (بما فيها المفاتيح المحمية)
--    ملاحظة: في Postgres RLS تُقيَّم سياسات GRANT بـ OR —
--    فوجود سياسة المؤسس يعني أن المؤسس يتجاوز قيود سياسة GM.
-- ============================================================
DROP POLICY IF EXISTS founder_app_settings_protected_update ON public.app_settings;
CREATE POLICY founder_app_settings_protected_update
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.misar_is_founder())
  WITH CHECK (public.misar_is_founder());

-- ============================================================
-- 4) حماية الحذف — الجزء الناقص الأهم:
--    المدير العام مع صلاحية settings.edit لا يملك DELETE أصلاً
--    في أغلب الإعدادات، لكن للتأمين الكامل نمنع الحذف صراحة
--    للمفاتيح المحمية من أي شخص غير المؤسس.
-- ============================================================
DROP POLICY IF EXISTS gm_app_settings_delete ON public.app_settings;
CREATE POLICY gm_app_settings_delete
  ON public.app_settings FOR DELETE
  TO authenticated
  USING (
    public.misar_is_founder()
    OR (
      public.misar_gm_can('settings', 'edit')
      AND NOT public.misar_app_settings_is_protected_key(setting_key)
    )
  );

-- ============================================================
-- 5) التحميل الافتراضي لملاحظات المؤسس (صف فارغ آمن)
--    يضمن وجود الصف ليقرأه المدير — لا يلمس بيانات موجودة.
-- ============================================================
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES ('founder_notes_v1', '[]', now())
ON CONFLICT (setting_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- التحقق (اختياري)
-- ============================================================

-- أ) الدالة تعتبر founder_notes_v1 محمياً و app_name غير محمي
SELECT public.misar_app_settings_is_protected_key('founder_notes_v1') AS notes_protected,      -- متوقع: t
       public.misar_app_settings_is_protected_key('app_name')         AS app_name_not_protected; -- متوقع: f

-- ب) قائمة سياسات app_settings بعد الإصلاح
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'app_settings'
ORDER BY policyname;

-- ج) المحاكاة: هل يمكن لمدير (بصلاحية settings.edit) تعديل الملاحظات؟
--    المتوقع: false — محظور
SELECT public.misar_gm_can('settings','edit')
       AND NOT public.misar_app_settings_is_protected_key('founder_notes_v1')
       AS gm_can_update_notes_should_be_false;
