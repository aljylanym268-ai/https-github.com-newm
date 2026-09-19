-- MISAR SYSTEMS
-- إصلاح قراءة الطلبات المتاحة وبيانات البائع دون كشف بيانات العميل قبل الاستلام.
-- شغّل هذا الملف من Supabase SQL Editor بصلاحية مدير.
-- لا ينشئ جداول ولا يغير بنية الجداول.
-- لا يحذف أي Policy غير السياسات المسماة هنا.

BEGIN;

-- ============================================================
-- 1) الطلبات المتاحة للمندوب
-- العلاقة المستخدمة فعلياً:
-- orders.seller_id -> user_data.id
-- و products.user_id كمسار احتياطي في التطبيق.
-- ============================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER يمنع دورة RLS بين orders و user_data.
-- لا ينشئ جدولاً ولا يتجاوز auth.uid().
CREATE OR REPLACE FUNCTION public.misar_is_founder_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type IN ('founder', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.misar_delivery_can_view_center(p_center text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type = 'delivery'
      AND u.status = 'approved'
      AND u.center = p_center
  );
$$;

-- احذف السياسات التي كانت تستعلم عن user_data من داخل orders مباشرة.
-- وجودها مع سياسة user_data التي تستعلم عن orders يسبب infinite recursion.
DROP POLICY IF EXISTS "Allow founder full access" ON public.orders;
DROP POLICY IF EXISTS "founder_all" ON public.orders;
DROP POLICY IF EXISTS "delivery_can_view_assigned_orders" ON public.orders;
DROP POLICY IF EXISTS "delivery_can_view_available_orders" ON public.orders;
DROP POLICY IF EXISTS "delivery_select_available_orders" ON public.orders;
DROP POLICY IF EXISTS "orders_select_for_admins" ON public.orders;
DROP POLICY IF EXISTS "founders_manage_user_data" ON public.user_data;
CREATE POLICY "founder_orders_access"
ON public.orders
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

CREATE POLICY "delivery_select_available_orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  delivery_id = (select auth.uid())
  OR (
    delivery_id IS NULL
    AND status IN ('confirmed', 'prepared')
    AND public.misar_delivery_can_view_center(center)
  )
);

-- ============================================================
-- 2) بيانات user_data بعد الاستلام فقط
-- لا نعطي المندوب قراءة user_data للبائع قبل الاستلام.
-- بطاقة الطلب المتاح تستخدم seller_* داخل orders.
-- ============================================================

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER يمنع دورة RLS عند فحص order participants.
CREATE OR REPLACE FUNCTION public.misar_user_can_read_order_party(p_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE (
      (o.delivery_id = (select auth.uid()) AND p_target_user IN (o.seller_id, o.buyer_id))
      OR (o.buyer_id = (select auth.uid()) AND p_target_user = o.seller_id)
      OR (o.seller_id = (select auth.uid()) AND p_target_user = o.seller_id)
    )
  );
$$;

DROP POLICY IF EXISTS "Allow founder full access" ON public.user_data;
DROP POLICY IF EXISTS "founder_all" ON public.user_data;
DROP POLICY IF EXISTS "user_data_select_authenticated" ON public.user_data;
DROP POLICY IF EXISTS "user_data_select_anon" ON public.user_data;
DROP POLICY IF EXISTS "user_data_select_for_order_participants" ON public.user_data;
CREATE POLICY "founder_user_data_access"
ON public.user_data
FOR SELECT
TO authenticated
USING (public.misar_is_founder_or_admin());

CREATE POLICY "user_data_select_for_order_participants"
ON public.user_data
FOR SELECT
TO authenticated
USING (
  id = (select auth.uid())
  OR public.misar_user_can_read_order_party(id)
);

-- ============================================================
-- 3) إصلاح الطلبات القديمة التي لا تحتوي seller snapshot
-- يتم التحديث من العلاقة الموجودة فعلياً فقط:
-- orders.seller_id -> user_data.id
-- أو products.user_id إذا كان seller_id في الطلب فارغاً.
-- لا يتم تعديل buyer_id أو customer_phone أو shipping_address.
--
-- ملاحظة: نستخدم فقط الأعمدة المؤكدة في user_data:
-- name, phone, center, governorate, address
-- إذا كانت الأعمدة التالية موجودة عندك وأردت تضمينها، أضفها يدوياً
-- بعد تنفيذ الاستعلام التشخيصي في نهاية الملف:
-- village, street_address, shop_address
-- ============================================================

-- عمود "village" لم يكن موجوداً في جدول user_data، لذلك حُذف من التحديث.
-- لو كان موجوداً عندك، أضفه إلى concat_ws(
--   seller_profile.governorate,
--   seller_profile.center,
--   seller_profile.village,
--   seller_profile.address,
--   seller_profile.street_address,
--   seller_profile.shop_address
-- )

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_data'
ORDER BY ordinal_position;

UPDATE public.orders AS o
SET
  seller_name = COALESCE(o.seller_name, seller_profile.name),
  seller_phone = COALESCE(o.seller_phone, seller_profile.phone),
  seller_address = COALESCE(
    o.seller_address,
    NULLIF(concat_ws(' - ',
      seller_profile.governorate,
      seller_profile.center,
      seller_profile.address
    ), '')
  ),
  seller_center = COALESCE(o.seller_center, seller_profile.center),
  seller_governorate = COALESCE(o.seller_governorate, seller_profile.governorate)
FROM public.products AS p,
     public.user_data AS seller_profile
WHERE p.id = o.product_id
  AND seller_profile.id = COALESCE(o.seller_id, p.user_id)
  AND o.status IN ('confirmed', 'prepared', 'picked_up', 'picked_up_from_seller', 'in_delivery', 'delivered')
  AND (
    o.seller_name IS NULL
    OR o.seller_phone IS NULL
    OR o.seller_address IS NULL
    OR o.seller_center IS NULL
    OR o.seller_governorate IS NULL
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- تشخيص SELECT فقط بعد التنفيذ
-- ============================================================

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'user_data')
ORDER BY tablename, policyname;

SELECT
  o.id AS order_id,
  o.product_id,
  o.seller_id AS order_seller_id,
  p.user_id AS product_seller_id,
  o.status,
  o.seller_name,
  o.seller_phone,
  o.seller_address,
  o.seller_center,
  o.seller_governorate
FROM public.orders AS o
LEFT JOIN public.products AS p ON p.id = o.product_id
WHERE o.status IN ('confirmed', 'prepared', 'picked_up', 'picked_up_from_seller', 'in_delivery', 'delivered')
ORDER BY o.created_at DESC;
