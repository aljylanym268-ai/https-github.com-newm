-- ============================================================
-- MISAR SYSTEMS — جدول محادثة المؤسس ↔ المدير العام
-- create_chat_messages_table.sql
-- ------------------------------------------------------------
-- الغرض:
--   • تخزين رسائل المحادثة بشكل دائم في قاعدة البيانات
--     (بدل localStorage + Broadcast فقط) حتى تصل للطرف الآخر
--     حتى لو لم يكن فاتح الشات لحظة الإرسال.
--   • دعم Supabase Realtime على الجدول ليصلك الرسائل الجديدة فوراً.
--
-- آمن 100%: Idempotent — يمكن تشغيله أكثر من مرة.
-- التنفيذ: مرة واحدة في Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) الجدول
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_key    text        NOT NULL,            -- مفاتيح الطرفين مرتبة: 'uuidA:uuidB'
    sender_id   uuid        NOT NULL,            -- معرّف المُرسِل (auth.uid)
    sender_name text        NOT NULL DEFAULT '',
    text        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- فهرس لجلب رسائل المحادثة بسرعة
CREATE INDEX IF NOT EXISTS chat_messages_pair_created_idx
    ON public.chat_messages (pair_key, created_at);

-- ============================================================
-- 2) تفعيل RLS
-- ============================================================
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) السياسات: كل طرف يرى ويكتب فقط رسائل محادثاته
-- ============================================================
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
    sender_id = auth.uid()
    AND array_length(string_to_array(pair_key, ':'), 1) = 2
    AND (
        split_part(pair_key, ':', 1) = (select auth.uid())::text
        OR split_part(pair_key, ':', 2) = (select auth.uid())::text
    )
);

DROP POLICY IF EXISTS "chat_messages_update_participants" ON public.chat_messages;
CREATE POLICY "chat_messages_update_participants"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "chat_messages_delete_participants" ON public.chat_messages;
CREATE POLICY "chat_messages_delete_participants"
ON public.chat_messages
FOR DELETE
TO authenticated
USING (sender_id = auth.uid());

-- ============================================================
-- 4) إعادة تحميل مخطط PostgREST حتى تتعرف الواجهة على الجدول فوراً
-- ============================================================
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- التحقق (اختياري)
-- ============================================================
-- SELECT * FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'chat_messages'
-- ORDER BY policyname;
