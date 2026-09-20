-- ============================================================
-- إصلاح مرتجعات البائع:
-- 1) تعبئة seller_id الفارغ في جدول returns اعتماداً على orders.seller_id
-- 2) ضمان سماح RLS للبائع بتحديث مرتجعاته (قبول/رفض)
-- ============================================================

-- 1) تعبئة seller_id الفارغ من الطلب المرتبط
--    (نستخدم product.user_id كمسار احتياطي إن كان orders.seller_id فارغاً،
--     تماماً كما يفعل التطبيق)
UPDATE public.returns r
SET seller_id = COALESCE(o.seller_id, p.user_id)
FROM public.orders o
LEFT JOIN public.products p ON p.id = o.product_id
WHERE r.order_id = o.id
  AND r.seller_id IS NULL
  AND COALESCE(o.seller_id, p.user_id) IS NOT NULL;

-- ملاحظة: نفّذ الأمر التالي للتحقق من النتيجة
-- SELECT id, order_id, seller_id, status FROM public.returns WHERE seller_id IS NULL;

-- 2) تمكين RLS والتحقق من سياسات التحديث
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

-- سياسة: البائع يرى مرتجعاته
DROP POLICY IF EXISTS "returns_select_seller" ON public.returns;
CREATE POLICY "returns_select_seller"
ON public.returns
FOR SELECT
TO authenticated
USING (
  seller_id = (select auth.uid())
  OR buyer_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = public.returns.order_id
      AND o.seller_id = (select auth.uid())
  )
);

-- سياسة: البائع (أو العميل) يستطيع تحديث مرتجعه (قبول/رفض)
DROP POLICY IF EXISTS "returns_update_seller" ON public.returns;
CREATE POLICY "returns_update_seller"
ON public.returns
FOR UPDATE
TO authenticated
USING (
  seller_id = (select auth.uid())
  OR buyer_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = public.returns.order_id
      AND o.seller_id = (select auth.uid())
  )
)
WITH CHECK (
  seller_id = (select auth.uid())
  OR buyer_id = (select auth.uid())
  OR delivery_id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = public.returns.order_id
      AND o.seller_id = (select auth.uid())
  )
);

-- سياسة: البائع يستطيع حذف مرتجعه (حذف فردي أو جماعي)
DROP POLICY IF EXISTS "returns_delete_seller" ON public.returns;
CREATE POLICY "returns_delete_seller"
ON public.returns
FOR DELETE
TO authenticated
USING (
  seller_id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = public.returns.order_id
      AND o.seller_id = (select auth.uid())
  )
);