-- ============================================================
-- MISAR SYSTEMS — حماية مفتاح ملاحظات المؤسس
-- FIX_protect_founder_notes.sql
-- ============================================================
-- الغرض:
--   إضافة مفتاح founder_notes_v1 إلى قائمة المفاتيح المحمية
--   في دالة misar_app_settings_is_protected_key، بحيث:
--   • المدير العام لا يستطيع تعديل أو حذف الملاحظات (RLS).
--   • المؤسس فقط يكتبها (عبر سياسة founder_app_settings_protected_update).
--
-- آمن 100%: Idempotent — يمكن تشغيله أكثر من مرة.
-- التنفيذ: مرة واحدة في Supabase SQL Editor.
-- ============================================================

BEGIN;

-- إعادة تعريف الدالة مع إدراج founder_notes_v1 في قائمة المفاتيح المحمية
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

COMMIT;

-- ============================================================
-- التحقق (اختياري)
-- ============================================================
SELECT public.misar_app_settings_is_protected_key('founder_notes_v1') AS notes_protected,
       public.misar_app_settings_is_protected_key('app_name')         AS app_name_not_protected;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'app_settings'
ORDER BY policyname;
