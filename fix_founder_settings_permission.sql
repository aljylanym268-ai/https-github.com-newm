-- ============================================================
-- إصلاح خطأ: permission denied for table users
-- عند الضغط على زر "إظهار/إخفاء صفحة المؤسس"
--
-- السبب: جدول (أو View) founder_settings يعتمد على جدول users
-- والمستخدم الحالي (founder) لا يملك صلاحية الكتابة عليه،
-- أو إن founder_settings هو View فوق users.
--
-- الحل: إنشاء جدول founder_settings مستقل + سياسات RLS آمنة
-- تعتمد على user_data (اللي المستخدم يملك الوصول لبياناته) بدل users.
--
-- نفّذ هذا الملف مرة واحدة في:
-- Supabase Dashboard → SQL Editor → New query → Run
--
-- ⚠️ لو ظهر "deadlock detected": هذه محاولة تعارض مع جلسة أخرى
--    تقرأ من الجدول (التطبيق أو تاب SQL آخر). أغلق باقي التابات
--    وأعد تشغيل نفس الملف — آمن للتكرار.
-- ============================================================

-- 0) لو الجلسة couldn't take a lock quickly، استسلم بسرعة بدل الاصطدام
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1) لو founder_settings موجود كـ VIEW فوق auth.users، نحفظ القيمة الحالية ثم نحذفه.
--    هذا هو سبب الخطأ "permission denied for table users":
--    القراءة من الـ View تتم بصلاحيات المالك ونجح، لكن الـ UPDATE
--    يُمرَّر إلى الجدول الأساسي auth.users والمستخدم العادي لا يملك صلاحية عليه.
DO $$
DECLARE
    v_kind text;
    v_visible boolean;
BEGIN
    SELECT relkind INTO v_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'founder_settings';

    IF v_kind IN ('v', 'm') THEN
        -- حفظ القيمة الحالية قبل الحذف حتى لا نفقد الإعداد المخزّن
        BEGIN
            SELECT page_visible INTO v_visible FROM public.founder_settings WHERE id = 1;
        EXCEPTION WHEN OTHERS THEN
            v_visible := true;
        END;
        EXECUTE 'DROP ' || CASE WHEN v_kind = 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END
                 || ' public.founder_settings';
        RAISE NOTICE 'تم حذف founder_settings كـ View (القيمة المحفوظة: %)', COALESCE(v_visible::text, 'true');

        -- إنشاء الجدول الحقيقي فورًا بنفس الأعمدة مع القيمة المحفوظة
        CREATE TABLE public.founder_settings (
            id bigint PRIMARY KEY,
            page_visible boolean NOT NULL DEFAULT true,
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO public.founder_settings (id, page_visible)
        VALUES (1, COALESCE(v_visible, true));
    END IF;
END $$;

-- 2) إنشاء الجدول إذا لم يكن موجودًا
CREATE TABLE IF NOT EXISTS public.founder_settings (
    id bigint PRIMARY KEY,
    page_visible boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) تفعيل RLS
ALTER TABLE public.founder_settings ENABLE ROW LEVEL SECURITY;

-- 4) مسح **كل** السياسات القديمة على الجدول مهما كانت أسماؤها.
--    سبق وأكدنا وجود سياسة قديمة باسم "Allow founder full access"
--    وهي على الأغلب التي تشير إلى auth.users وتسبب الخطأ.
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'founder_settings'
        ORDER BY policyname
    LOOP
        BEGIN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.founder_settings', pol.policyname);
            RAISE NOTICE 'تم حذف السياسة القديمة: %', pol.policyname;
        EXCEPTION WHEN lock_not_available THEN
            RAISE NOTICE 'الجدول مشغول الآن، أعِد تشغيل الملف لحذف: %', pol.policyname;
        END;
    END LOOP;
END $$;

-- 5) الجميع (حتى الزوار) يقدروا يقرؤوا الإعداد
--    مطلوب لأن الصفحة بتتحقق من الرؤية لكل زائر
CREATE POLICY "founder_settings_read_all"
ON public.founder_settings
FOR SELECT
USING (true);

-- 6) المؤسس فقط (حسب user_data.account_type) يقدر يعدّل الإعداد
--    ملاحظة: نستخدم user_data مش users عشان نتجنب مشكلة الصلاحيات
CREATE POLICY "founder_settings_founder_write"
ON public.founder_settings
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_data ud
        WHERE ud.id = auth.uid()
          AND ud.account_type = 'founder'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_data ud
        WHERE ud.id = auth.uid()
          AND ud.account_type = 'founder'
    )
);

-- 7) تحديث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION public.touch_founder_settings()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS founder_settings_touch ON public.founder_settings;
CREATE TRIGGER founder_settings_touch
    BEFORE UPDATE ON public.founder_settings
    FOR EACH ROW EXECUTE FUNCTION public.touch_founder_settings();

-- 8) إنشاء الصف الافتراضي إذا لم يكن موجودًا (لا يمس القيمة الموجودة)
INSERT INTO public.founder_settings (id, page_visible)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- 9) منح صلاحيات الجداول الافتراضية (تأكيد إضافي)
GRANT SELECT ON public.founder_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.founder_settings TO authenticated;

-- ============================================================
-- اختبار سريع: من المفروض يرجّع صف واحد بدون أخطاء
-- ============================================================
SELECT * FROM public.founder_settings WHERE id = 1;

-- ============================================================
-- تشخيص: نوع الكائن + السياسات الموجودة فعلاً بعد التنفيذ
-- (relkind المفروض يكون 'r' = جدول حقيقي)
-- ============================================================
SELECT c.relname, c.relkind,
       CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' END AS kind_text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'founder_settings';

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'founder_settings';

-- ============================================================
-- ملاحظات مهمة:
-- 1) ⚠️ لا تمنح أبداً أي صلاحية (GRANT) على auth.users
--    للمستخدمين العاديين — هذا جدول نظام حساس.
--    الإصلاح أعلاه لا يحتاج أي صلاحية على auth.users إطلاقاً.
--
-- 2) تأكد أن صفك في user_data عليه account_type = 'founder':
--
--    SELECT id, account_type FROM public.user_data
--    WHERE id = auth.uid();
--
--    لو مش founder، شغّل (وحدّث الـ id لحسابك):
--
--    UPDATE public.user_data SET account_type = 'founder'
--    WHERE id = auth.uid();
-- ============================================================
