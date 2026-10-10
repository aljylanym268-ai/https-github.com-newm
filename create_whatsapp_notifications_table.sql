-- =====================================================================
-- MISAR SYSTEMS - جدول سجل إشعارات WhatsApp (منع التكرار + السجل)
-- =====================================================================
-- الغرض:
--   1) منع إرسال نفس الإشعار أكثر من مرة لنفس الطلب (قيد UNIQUE).
--   2) حفظ سجل بكل محاولة إرسال (نجاح/فشل/تخطي) لتتبع الأخطاء.
--
-- آمن 100%: لا يعدّل جدول orders ولا جدول notifications ولا أي RLS Policy
-- قائم في المشروع. يضيف جدولاً جديداً فقط + سياسات خاصة به.
--
-- التشغيل: مرة واحدة في Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الجدول
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL,
  event         text        NOT NULL,          -- order_created / order_accepted / ...
  recipient     text,                          -- الرقم الدولي، NULL إذا لم يوجد رقم صالح
  seller_name   text,
  status        text        NOT NULL DEFAULT 'pending',
                -- pending | sent | failed | skipped_no_phone
  error_detail  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,

  CONSTRAINT whatsapp_notifications_event_check
    CHECK (event IN (
      'order_created', 'order_accepted', 'order_prepared',
      'order_delivered', 'order_cancelled', 'return_requested'
    ))
);

-- ---------------------------------------------------------------------
-- 2) منع التكرار: لا تتكرر الرسالة لنفس (طلب + حدث) أبداً.
--    هذا هو حاجز الأمان الحقيقي حتى لو تكرر النداء أو إعادة تحميل الصفحة.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notifications_order_event_uniq
  ON public.whatsapp_notifications (order_id, event);

CREATE INDEX IF NOT EXISTS whatsapp_notifications_created_at_idx
  ON public.whatsapp_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_notifications_status_idx
  ON public.whatsapp_notifications (status);

-- ---------------------------------------------------------------------
-- 3) الربط بجدول الطلبات (يفشل بأمان إن كان orders.id ليس uuid)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND data_type = 'uuid'
  ) THEN
    BEGIN
      ALTER TABLE public.whatsapp_notifications
        ADD CONSTRAINT whatsapp_notifications_order_fk
        FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
      RAISE NOTICE 'FK to orders(id) added';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'FK skipped: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'orders.id is not uuid - FK not added (table works fine without it)';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4) RLS + السياسات
--    الجدول يُقرأ ويُكتب من الـ Edge Function فقط (service role يتجاوز RLS).
--    الحذف مسموح للمؤسس فقط، ووصول البائع للطلبات الجديدة خاصيته فقط.
-- ---------------------------------------------------------------------
ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_notifications_read_participant ON public.whatsapp_notifications;
CREATE POLICY whatsapp_notifications_read_participant
  ON public.whatsapp_notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = whatsapp_notifications.order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS whatsapp_notifications_founder_all ON public.whatsapp_notifications;
CREATE POLICY whatsapp_notifications_founder_all
  ON public.whatsapp_notifications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_data ud
      WHERE ud.id = auth.uid()
        AND ud.account_type IN ('founder', 'admin')
    )
  );

-- ملاحظة: لا توجد سياسة INSERT هنا عن قصد.
-- الإدراج يتم حصراً من misar-whatsapp Edge Function بمفتاح service role،
-- حتى لا يستطيع أي مستخدم من المتصفح إضافة سجلات وهمية.