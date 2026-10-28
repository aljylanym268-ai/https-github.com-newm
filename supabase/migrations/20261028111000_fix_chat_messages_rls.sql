BEGIN;

DROP POLICY IF EXISTS "chat_messages_select_participants" ON public.chat_messages;
CREATE POLICY "chat_messages_select_participants"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
    array_length(string_to_array(pair_key, ':'), 1) = 2
    AND (
        split_part(pair_key, ':', 1) = (select auth.uid())::text
        OR split_part(pair_key, ':', 2) = (select auth.uid())::text
    )
);

DROP POLICY IF EXISTS "chat_messages_insert_participants" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_participants"
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
);

NOTIFY pgrst, 'reload schema';

COMMIT;
