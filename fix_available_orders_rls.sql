-- MISAR SYSTEMS: السماح للمندوب بقراءة الطلبات المتاحة فقط
-- شغّل هذا الملف من Supabase SQL Editor بصلاحية مدير بعد مراجعة سياسات orders الحالية.
-- لا ينشئ جداول أو يغيّر بنية قاعدة البيانات.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- هذه السياسات العامة تلغي عملياً حماية RLS وتكشف كل أعمدة الطلبات/المستخدمين.
-- يجب حذفها حتى لا يحصل المندوب أو أي مستخدم على بيانات العميل قبل الاستلام.
DROP POLICY IF EXISTS "orders_read" ON public.orders;
DROP POLICY IF EXISTS "delivery_can_view_available_orders" ON public.orders;
DROP POLICY IF EXISTS "delivery_select_available_orders" ON public.orders;

-- سياسة القراءة الحالية للطلبات المتاحة للمندوب فقط
DROP POLICY IF EXISTS "delivery_select_available_orders" ON public.orders;
CREATE POLICY "delivery_select_available_orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  delivery_id = (select auth.uid())
  OR (
    delivery_id IS NULL
    AND status IN ('confirmed', 'prepared')
    AND EXISTS (
      SELECT 1
      FROM public.user_data delivery_user
      WHERE delivery_user.id = (select auth.uid())
        AND delivery_user.account_type = 'delivery'
        AND delivery_user.center = orders.center
    )
  )
);

-- لا نعتمد على user_data قبل الاستلام؛ بطاقة الطلب تعتمد على seller_* snapshot
-- الموجود داخل orders. بعد الاستلام فقط يسمح للمشارك بقراءة بيانات البائع/العميل المرتبطين بالطلب.
DROP POLICY IF EXISTS "user_data_select_authenticated" ON public.user_data;
DROP POLICY IF EXISTS "user_data_select_for_order_participants" ON public.user_data;
CREATE POLICY "user_data_select_for_order_participants"
ON public.user_data
FOR SELECT
TO authenticated
USING (
  id = (select auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.orders participant_order
    WHERE (
      participant_order.seller_id = (select auth.uid())
      OR participant_order.buyer_id = (select auth.uid())
      OR participant_order.delivery_id = (select auth.uid())
    )
    AND (
      public.user_data.id = participant_order.seller_id
      OR (
        participant_order.delivery_id = (select auth.uid())
        AND public.user_data.id = participant_order.buyer_id
      )
    )
  )
);

-- لا يمكن جعل user_data_select_anon آمناً على مستوى الأعمدة باستخدام RLS،
-- لذلك نحذفه لأن user_data يحتوي هاتفاً وعناوين حساسة.
DROP POLICY IF EXISTS "user_data_select_anon" ON public.user_data;

NOTIFY pgrst, 'reload schema';

-- تشخيص مصدر بيانات البائع (نفذه بصلاحية مدير، ولا يعرض بيانات عميل للواجهة):
SELECT
  o.id AS order_id,
  o.product_id,
  o.seller_id AS order_seller_id,
  p.user_id AS product_seller_id,
  o.seller_name,
  o.seller_phone,
  o.seller_address,
  ud.name AS seller_profile_name,
  ud.phone AS seller_profile_phone,
  ud.address AS seller_profile_address
FROM public.orders o
LEFT JOIN public.products p ON p.id = o.product_id
LEFT JOIN public.user_data ud ON ud.id = COALESCE(o.seller_id, p.user_id)
WHERE o.delivery_id IS NULL
  AND o.status IN ('confirmed', 'prepared')
ORDER BY o.created_at ASC;

-- تحقق من السياسات بعد التطبيق:
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'user_data')
ORDER BY tablename, policyname;
