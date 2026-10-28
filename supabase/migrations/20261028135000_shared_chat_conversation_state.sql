BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_conversations (
    pair_key text PRIMARY KEY,
    founder_id uuid NOT NULL,
    manager_id uuid NOT NULL,
    is_closed boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chat_conversations_distinct_participants
        CHECK (founder_id <> manager_id),
    CONSTRAINT chat_conversations_pair_key_matches_participants
        CHECK (pair_key = (LEAST(founder_id, manager_id)::text || ':' || GREATEST(founder_id, manager_id)::text))
);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chat_conversations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.chat_conversations TO authenticated;

CREATE OR REPLACE FUNCTION public.misar_chat_is_founder()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_data
        WHERE id = (select auth.uid())
          AND account_type = 'founder'
    );
$$;

CREATE OR REPLACE FUNCTION public.misar_chat_is_general_manager(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_data
        WHERE id = p_user_id
          AND account_type = 'general_manager'
          AND status = 'approved'
    ) AND public.misar_chat_is_founder();
$$;

CREATE OR REPLACE FUNCTION public.misar_get_chat_founder_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    caller_is_gm boolean;
    founder_uuid uuid;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.user_data
        WHERE id = (select auth.uid())
          AND account_type = 'general_manager'
          AND status = 'approved'
    ) INTO caller_is_gm;

    IF NOT caller_is_gm THEN
        RAISE EXCEPTION 'Only an approved general manager can open the founder chat.';
    END IF;

    SELECT id INTO founder_uuid
    FROM public.user_data
    WHERE account_type = 'founder'
    ORDER BY id
    LIMIT 1;

    RETURN founder_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.misar_chat_conversation_is_closed(p_pair_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT COALESCE((
        SELECT c.is_closed
        FROM public.chat_conversations c
        WHERE c.pair_key = p_pair_key
          AND (select auth.uid()) IN (c.founder_id, c.manager_id)
    ), false);
$$;

REVOKE ALL ON FUNCTION public.misar_chat_is_founder() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.misar_chat_is_general_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.misar_get_chat_founder_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.misar_chat_conversation_is_closed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.misar_chat_is_founder() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.misar_chat_is_general_manager(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.misar_get_chat_founder_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.misar_chat_conversation_is_closed(text) TO authenticated, service_role;

DROP POLICY IF EXISTS chat_conversations_select_participants ON public.chat_conversations;
CREATE POLICY chat_conversations_select_participants
ON public.chat_conversations
FOR SELECT
TO authenticated
USING ((select auth.uid()) IN (founder_id, manager_id));

DROP POLICY IF EXISTS chat_conversations_insert_founder ON public.chat_conversations;
CREATE POLICY chat_conversations_insert_founder
ON public.chat_conversations
FOR INSERT
TO authenticated
WITH CHECK (
    founder_id = (select auth.uid())
    AND public.misar_chat_is_founder()
    AND public.misar_chat_is_general_manager(manager_id)
);

DROP POLICY IF EXISTS chat_conversations_update_founder ON public.chat_conversations;
CREATE POLICY chat_conversations_update_founder
ON public.chat_conversations
FOR UPDATE
TO authenticated
USING (
    founder_id = (select auth.uid())
    AND public.misar_chat_is_founder()
)
WITH CHECK (
    founder_id = (select auth.uid())
    AND public.misar_chat_is_founder()
    AND public.misar_chat_is_general_manager(manager_id)
);

DROP POLICY IF EXISTS chat_messages_insert_participants ON public.chat_messages;
CREATE POLICY chat_messages_insert_participants
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
    sender_id = (select auth.uid())
    AND array_length(string_to_array(pair_key, ':'), 1) = 2
    AND (
        split_part(pair_key, ':', 1) = (select auth.uid())::text
        OR split_part(pair_key, ':', 2) = (select auth.uid())::text
    )
    AND (
        public.misar_chat_is_founder()
        OR NOT public.misar_chat_conversation_is_closed(pair_key)
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'chat_conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
    END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
