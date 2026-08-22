-- Migration: allow buyers to delete their own orders
-- Run this in Supabase SQL editor

-- سياسة تسمح للعميل بحذف طلباته الخاصة فقط
CREATE POLICY "buyers_can_delete_own_orders"
ON public.orders
FOR DELETE
TO authenticated
USING (buyer_id = auth.uid());

-- ملاحظة: إذا كانت السياسة موجودة بالفعل ستفشل العملية،
-- يمكنك تجاهل الخطأ أو حذف السياسة القديمة أولاً:
-- DROP POLICY IF EXISTS "buyers_can_delete_own_orders" ON public.orders;
