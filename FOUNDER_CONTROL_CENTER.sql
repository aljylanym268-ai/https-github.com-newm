-- =====================================================================
-- MISAR SYSTEMS — مركز التحكم في إشعارات المؤسس
-- FOUNDER_CONTROL_CENTER.sql
-- =====================================================================
-- الغرض:
--   1) تخزين إعدادات إشعارات المؤسس في app_settings (مفتاح واحد فقط).
--   2) جدول سجل/منع تكرار لأحداث إشعارات المؤسس (founder_notifications).
--   3) دوال مساعدة محمية (SECURITY DEFINER) لقراءة الإعدادات على الخادم.
--
-- آمن 100%:
--   • لا يحذف أي جدول/سياسة/دالة قائمة.
--   • لا يعدّل misar-whatsapp ولا misar-ai ولا أي جدول قائم.
--   • لا يضعف RLS: يضيف سياسات خاصة بالجدول الجديد فقط.
--   • Idempotent: يمكن تشغيله أكثر من مرة بأمان.
--
-- التشغيل: مرة واحدة في Supabase SQL Editor.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) فحص استباقي: نوع عمود setting_value
--    بعض المشاريع تستخدم text وأخرى jsonb. السكربت يعمل مع النوعين،
--    لكن نُسجّل النوع في سجل التشغيل لتشخيص أي مشكلة مستقبلاً.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.app_settings'::regclass
    AND a.attname = 'setting_value'
    AND NOT a.attisdropped;

  RAISE NOTICE 'app_settings.setting_value نوعه: %', COALESCE(v_type, 'غير موجود');

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'العمود app_settings.setting_value غير موجود — تأكد من إنشاء الجدول أولاً';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) الإعداد الافتراضي في app_settings
--    المفتاح: notification_settings (JSONB داخل عمود text — نُحوّل دائماً بـ ::jsonb)
--    - master_enabled: مفتاح رئيسي لتفعيل/إيقاف الكل.
--    - channel: القناة الحالية (whatsapp).
--    - founder_whatsapp_number: رقم استقبال إشعارات المؤسس.
--    - types: مفتاح لكل نوع إشعار.
--
--    ملاحظة: الأحداث التي لا يوجد لها مصدر حقيقي بعد (تأخر التوصيل،
--    محاولة وصول مرفوضة، خطأ تقني، تسجيل دخول المدير العام)
--    تُضبط false افتراضياً حتى يتم ربطها بمصدر حقيقي.
-- ---------------------------------------------------------------------
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES (
  'notification_settings',
  '{
    "master_enabled": true,
    "channel": "whatsapp",
    "founder_whatsapp_number": "",
    "types": {
      "new_client": true,
      "new_seller": true,
      "new_delivery": true,
      "account_verification": true,
      "order_created": true,
      "order_status_changed": true,
      "order_accepted": true,
      "order_rejected": true,
      "order_cancelled": true,
      "return_requested": true,
      "delivery_delayed": false,
      "delivery_problem": false,
      "complaint_new": true,
      "gm_login": false,
      "gm_permissions_changed": true,
      "admin_suspended": true,
      "platform_settings_changed": true,
      "unauthorized_access": false,
      "critical_error": false,
      "notification_failed": true
    }
  }'::text,
  now()
)
ON CONFLICT (setting_key) DO NOTHING;

-- توافق: بعض مشاريعك قد تكون أُنشئت بعمود setting_value من نوع jsonb
-- وبعضها من نوع text. الإدراج أعلاه يكتب نصاً صالحاً (JSON) ويصلح للنوعين.
-- ملاحظة للدالة misar_get_notification_settings(): تستخدم setting_value::jsonb
-- وهو يعمل مع النوعين (text ⇒ jsonb عبر تحويل صريح).

-- ---------------------------------------------------------------------
-- 2) جدول سجل إشعارات المؤسس (منع تكرار + سجل الحالة)
--    منفصل عن whatsapp_notifications لأن ذلك الجدول مرتبط إلزامياً
--    بـ order_id وقيد CHECK خاص بأحداث الطلبات.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.founder_notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key     text        NOT NULL,          -- مفتاح فريد لمنع التكرار: "order_created:<uuid>"
  event_type    text        NOT NULL,          -- نوع الحدث المنطقي (order_created / new_seller / ...)
  channel       text        NOT NULL DEFAULT 'whatsapp',
  recipient     text,                          -- رقم المؤسس المستهدف (مطبوّع)
  status        text        NOT NULL DEFAULT 'pending',
                            -- pending | sent | failed | skipped_disabled | skipped_no_recipient | skipped_no_secret
  error_detail  text,
  payload       jsonb,                          -- بيانات الحدث غير الحساسة فقط (بدون أرقام عملاء/عناوين)
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

-- منع التكرار: لا يُرسل نفس الحدث أكثر من مرة.
CREATE UNIQUE INDEX IF NOT EXISTS founder_notifications_event_key_uniq
  ON public.founder_notifications (event_key);

CREATE INDEX IF NOT EXISTS founder_notifications_created_at_idx
  ON public.founder_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS founder_notifications_status_idx
  ON public.founder_notifications (status);

-- ---------------------------------------------------------------------
-- 3) RLS: قراءة للمؤسس فقط. الإدراج/التحديث من الـ Edge Function
--    (service role يتجاوز RLS). لا سياسة INSERT للمتصفح.
-- ---------------------------------------------------------------------
ALTER TABLE public.founder_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS founder_notifications_founder_read ON public.founder_notifications;
CREATE POLICY founder_notifications_founder_read
  ON public.founder_notifications FOR SELECT
  TO authenticated
  USING (public.misar_is_founder());

-- المؤسس فقط يمكنه حذف سجلاته (تنظيف يدوي). لا UPDATE/DELETE لغيره.
DROP POLICY IF EXISTS founder_notifications_founder_delete ON public.founder_notifications;
CREATE POLICY founder_notifications_founder_delete
  ON public.founder_notifications FOR DELETE
  TO authenticated
  USING (public.misar_is_founder());

-- ---------------------------------------------------------------------
-- 4) دالة مساعدة: قراءة الإعدادات على الخادم (SECURITY DEFINER)
--    تُستخدم من Edge Function ومحمية من الاستدعاء العشوائي.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.misar_get_notification_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT setting_value::jsonb
     FROM public.app_settings
     WHERE setting_key = 'notification_settings'),
    '{}'::jsonb
  );
$$;

-- ---------------------------------------------------------------------
-- 5) حماية المفتاح الحساس من تعديل المدير العام
--    نضيف سياسة UPDATE جديدة خاصة بالمؤسس على app_settings، ونستثني
--    المفاتيح الحساسة من سياسة GM القائمة (لا نحذفها، فقط نضيف شرطاً
--    عبر دالة تحقق). الأسلوب: دالة misar_app_settings_is_protected_key.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.misar_app_settings_is_protected_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_key IN (
    'notification_settings',
    'founder_whatsapp_number',
    'founder_settings',
    'general_manager_permissions',
    'general_manager_suspended',
    'general_manager_sections'
  );
$$;

-- سياسة جديدة (إضافية) تمنح المؤسس وحده الكتابة على المفاتيح المحمية.
-- لا نحذف السياسة القائمة gm_app_settings_update، لكن نضيف هذه لتغطية
-- الحالة التي قد لا تكون مغطاة.
DROP POLICY IF EXISTS founder_app_settings_protected_update ON public.app_settings;
CREATE POLICY founder_app_settings_protected_update
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.misar_is_founder())
  WITH CHECK (public.misar_is_founder());

-- ---------------------------------------------------------------------
-- 6) تشخيص
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '✅ notification_settings key ready';
  RAISE NOTICE '✅ founder_notifications table ready';
  RAISE NOTICE '✅ misar_get_notification_settings() ready';
  RAISE NOTICE '✅ misar_app_settings_is_protected_key() ready';
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- 7) تحقق نهائي (اختياري)
--
-- ملاحظة مهمة: عمود app_settings.setting_value عندك من نوع text وليس jsonb.
--   jsonb_pretty() تقبل jsonb فقط ولا تُحوّل النص ضمنياً ⇒ الخطأ:
--   "function jsonb_pretty(text) does not exist".
--   لذلك نُحوّل صراحةً بـ (setting_value::jsonb) ولا نغيّر نوع العمود
--   (تغييره قد يُعطّل كوداً آخر يعتمد على text).
--   نستخدم FILTER/WHERE صريحاً حتى لا يفشل التحويل لو كان النص غير صالح.
-- ---------------------------------------------------------------------
-- آمن للنوعين (text أو jsonb):
--   left(btrim(x),1) in ('{','[') هي طريقة بسيطة بلا تعبير نمطي (لا backslashes)
--   لتحديد إن كان المحتوى JSON، ثم نُنسّقه بـ jsonb_pretty.
SELECT setting_key,
       CASE
         WHEN setting_value IS NULL THEN NULL
         WHEN left(btrim(setting_value::text), 1) IN ('{', '[') THEN
           jsonb_pretty(setting_value::text::jsonb)
         ELSE setting_value::text
       END AS value,
       pg_typeof(setting_value)::text AS column_type
FROM public.app_settings
WHERE setting_key = 'notification_settings';

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'founder_notifications'
ORDER BY policyname;
