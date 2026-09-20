-- ============================================================
-- إصلاح استلام الطلب من المندوب - MISAR SYSTEMS
-- شغّل في Supabase Dashboard → SQL Editor
--
-- السبب: السياسة الحالية "sellers_update_own_orders" تشترط
-- delivery_id = auth.uid() على الصف القديم، وهذا مستحيل
-- لأن المندوب لم يُسند له الطلب بعد (delivery_id = NULL).
--
-- الحل: سياسة خاصة بعملية الإسناد (claim) فقط، آمنة
-- ولا تفتح UPDATE عام:
--   * الصف القديم لازم يكون delivery_id IS NULL وحالته confirmed/prepared
--   * القيمة الجديدة لازم delivery_id = auth.uid()
--   * لا يمكن إسناد الطلب لغير المندوب المسجل نفسه
-- ============================================================

-- إزالة أي نسخة قديمة من هذه السياسة فقط (لا نلمس السياسات الأخرى)
DROP POLICY IF EXISTS "delivery_claim_order" ON public.orders;

CREATE POLICY "delivery_claim_order"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  delivery_id IS NULL
  AND status IN ('confirmed', 'prepared')
)
WITH CHECK (
  delivery_id = (select auth.uid())
  AND status = 'picked_up'
);

-- التأكد من أن RLS مفعّل (لا يغيّر الهيكل)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- التحقق من السياسات النشطة
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders';
