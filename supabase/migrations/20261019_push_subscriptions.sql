-- Push subscriptions are private to the authenticated account that registered them.
-- Edge Functions use the service role to deliver notifications to the order's seller.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_subscriptions_endpoint_https CHECK (endpoint LIKE 'https://%'),
    CONSTRAINT push_subscriptions_endpoint_length CHECK (length(endpoint) <= 2048),
    CONSTRAINT push_subscriptions_p256dh_length CHECK (length(p256dh) BETWEEN 40 AND 256),
    CONSTRAINT push_subscriptions_auth_length CHECK (length(auth) BETWEEN 16 AND 128)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
    ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own
    ON public.push_subscriptions FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own
    ON public.push_subscriptions FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_own
    ON public.push_subscriptions FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own
    ON public.push_subscriptions FOR DELETE TO authenticated
    USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
