-- ============================================================
-- إصلاح "إلغاء الطلب" و "حذف الطلب" للعميل (Buyer)
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor
-- ============================================================
-- المشكلة: سياسات RLS على جدول orders كانت تمنع:
--   1) تحديث حالة الطلب إلى cancelled  (زر "إلغاء الطلب")
--   2) حذف الطلب                       (زر "حذف")
-- هذا السكربت يعيد إنشاء السياسات بشكل نظيف وآمن.
-- ============================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 1) إزالة أي سياسات قديمة متعارضة على جدول orders
--    (نلمس فقط سياسات العميل الخاصة بالإلغاء/الحذف)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "buyers_insert_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_select_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_update_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_can_delete_own_orders" ON public.orders;
DROP POLICY IF EXISTS "buyers_delete_own_orders" ON public.orders;

-- ------------------------------------------------------------
-- 2) INSERT: العميل ينشئ طلباته فقط
-- ------------------------------------------------------------
CREATE POLICY "buyers_insert_own_orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (buyer_id = auth.uid());

-- ------------------------------------------------------------
-- 3) SELECT: كل طرف في الطلب (عميل/بائع/مندوب) يرى الطلب
-- ------------------------------------------------------------
CREATE POLICY "buyers_select_own_orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR delivery_id = auth.uid()
);

-- ------------------------------------------------------------
-- 4) UPDATE: العميل يقدر يحدّث حالته إلى cancelled
--    (الـ USING يحدد الصفوف المسموح تعديلها، والـ WITH CHECK
--     يضمن أن الصف يبقى مملوكاً لنفس المستخدم بعد التعديل)
-- ------------------------------------------------------------
CREATE POLICY "buyers_update_own_orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR delivery_id = auth.uid()
)
WITH CHECK (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR delivery_id = auth.uid()
);

-- ------------------------------------------------------------
-- 5) DELETE: العميل يقدر يحذف طلباته فقط
--    (السياسة الأهم التي كانت مفقودة)
-- ------------------------------------------------------------
CREATE POLICY "buyers_delete_own_orders"
ON public.orders
FOR DELETE
TO authenticated
USING (buyer_id = auth.uid());

-- ------------------------------------------------------------
-- 6) تحقق: اعرض كل سياسات جدول orders بعد التطبيق
--    يجب أن ترى buyers_update_own_orders و buyers_delete_own_orders
-- ------------------------------------------------------------
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders'
ORDER BY policyname;
