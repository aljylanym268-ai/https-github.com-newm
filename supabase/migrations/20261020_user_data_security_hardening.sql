-- Restrict user profiles to their owner, approved administrators, authorized
-- general managers, and participants in a valid order.
BEGIN;

CREATE OR REPLACE FUNCTION public.misar_is_founder_or_legacy_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_data u
    WHERE u.id = (select auth.uid())
      AND u.account_type IN ('founder', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.misar_can_read_order_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.products p ON p.id = o.product_id
    WHERE p.user_id = o.seller_id
      AND (
        (
          (o.buyer_id = (select auth.uid()) OR o.seller_id = (select auth.uid()))
          AND p_profile_id IN (o.buyer_id, o.seller_id)
        )
        OR (
          o.delivery_id = (select auth.uid())
          AND p_profile_id IN (o.buyer_id, o.seller_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.misar_protect_founder_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR public.misar_is_founder() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.account_type IN ('founder', 'general_manager', 'admin') THEN
      RAISE EXCEPTION 'Only the founder can delete a privileged account.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.account_type IN ('founder', 'general_manager', 'admin') THEN
      RAISE EXCEPTION 'Only the founder can assign a privileged account role.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.account_type IN ('founder', 'general_manager', 'admin') THEN
    RAISE EXCEPTION 'Only the founder can modify a privileged account.';
  END IF;

  IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    RAISE EXCEPTION 'Only the founder can change an account role.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only the founder can change account approval status.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_protect_founder_trigger ON public.user_data;
CREATE TRIGGER misar_protect_founder_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_protect_founder_row();

CREATE OR REPLACE FUNCTION public.misar_validate_order_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  product_seller uuid;
  courier_is_approved boolean;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.buyer_id IS DISTINCT FROM (select auth.uid()) THEN
      RAISE EXCEPTION 'Customers may create orders only for their own account.';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.delivery_id IS NOT NULL THEN
      RAISE EXCEPTION 'New customer orders must be pending and unassigned.';
    END IF;
    SELECT p.user_id INTO product_seller
    FROM public.products p
    WHERE p.id = NEW.product_id;
    IF product_seller IS NULL OR product_seller IS DISTINCT FROM NEW.seller_id THEN
      RAISE EXCEPTION 'The order seller must own the ordered product.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
      OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
      OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'Order participants and product cannot be changed.';
  END IF;

  IF OLD.delivery_id IS NULL
      AND NEW.delivery_id = (select auth.uid())
      AND OLD.status IN ('confirmed', 'prepared')
      AND NEW.status = 'picked_up' THEN
    SELECT u.account_type = 'delivery'
      AND u.status = 'approved'
      AND u.center IS NOT DISTINCT FROM OLD.center
    INTO courier_is_approved
    FROM public.user_data u
    WHERE u.id = (select auth.uid());
    IF COALESCE(courier_is_approved, false) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only an approved delivery person can claim this order.';
  END IF;

  IF OLD.delivery_id = (select auth.uid())
      AND OLD.status = 'picked_up'
      AND NEW.status = 'prepared'
      AND NEW.delivery_id IS NULL THEN
    SELECT u.account_type = 'delivery' AND u.status = 'approved'
    INTO courier_is_approved
    FROM public.user_data u
    WHERE u.id = (select auth.uid());
    IF COALESCE(courier_is_approved, false) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the assigned delivery person can release this order.';
  END IF;

  IF (select auth.uid()) = OLD.buyer_id AND
      NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    RAISE EXCEPTION 'Customers cannot assign or replace a delivery person.';
  END IF;
  IF (select auth.uid()) = OLD.seller_id AND
      NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    RAISE EXCEPTION 'Sellers cannot assign or replace a delivery person.';
  END IF;
  IF OLD.delivery_id = (select auth.uid()) AND
      NEW.delivery_id IS NOT NULL AND NEW.delivery_id <> (select auth.uid()) THEN
    RAISE EXCEPTION 'A delivery person cannot assign an order to another account.';
  END IF;
  IF (select auth.uid()) <> OLD.buyer_id
      AND (select auth.uid()) <> OLD.seller_id
      AND (select auth.uid()) IS DISTINCT FROM OLD.delivery_id
      AND NOT public.misar_is_founder_or_legacy_admin()
      AND NOT public.misar_gm_can('orders', 'edit') THEN
    RAISE EXCEPTION 'Only an order participant or authorized administrator can update this order.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_validate_order_participants ON public.orders;
CREATE TRIGGER misar_validate_order_participants
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.misar_validate_order_participants();

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_data'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_data', policy_row.policyname);
  END LOOP;
END;
$$;

CREATE POLICY user_data_select_self
  ON public.user_data FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY user_data_select_order_participants
  ON public.user_data FOR SELECT TO authenticated
  USING (public.misar_can_read_order_profile(id));

CREATE POLICY user_data_select_admin
  ON public.user_data FOR SELECT TO authenticated
  USING (public.misar_is_founder_or_legacy_admin());

CREATE POLICY user_data_select_authorized_gm
  ON public.user_data FOR SELECT TO authenticated
  USING (public.misar_gm_can('users', 'view'));

CREATE POLICY user_data_update_admin
  ON public.user_data FOR UPDATE TO authenticated
  USING (public.misar_is_founder_or_legacy_admin())
  WITH CHECK (public.misar_is_founder_or_legacy_admin());

CREATE POLICY user_data_insert_self
  ON public.user_data FOR INSERT TO authenticated
  WITH CHECK (
    id = (select auth.uid())
    AND account_type NOT IN ('founder', 'general_manager', 'admin')
  );

CREATE POLICY user_data_update_self
  ON public.user_data FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

CREATE POLICY user_data_delete_admin
  ON public.user_data FOR DELETE TO authenticated
  USING (public.misar_is_founder_or_legacy_admin());

CREATE POLICY user_data_update_authorized_gm
  ON public.user_data FOR UPDATE TO authenticated
  USING (
    public.misar_gm_can('users', 'edit')
    AND account_type NOT IN ('founder', 'general_manager', 'admin')
  )
  WITH CHECK (
    public.misar_gm_can('users', 'edit')
    AND account_type NOT IN ('founder', 'general_manager', 'admin')
  );

REVOKE ALL ON FUNCTION public.misar_is_founder_or_legacy_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.misar_can_read_order_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.misar_is_founder_or_legacy_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.misar_can_read_order_profile(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
