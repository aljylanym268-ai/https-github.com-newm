-- ============================================================
-- كلمات مرور الحسابات — النسخة المضمونة (شغّلها مرة واحدة)
-- المؤسس يرى ويحدد كلمة المرور لكل حساب
-- المدراء العامون يروها فقط إذا فعّل المؤسس السياسة
-- ============================================================

-- 1) جدول كلمات المرور (بدون قيد خارجي صارم حتى لا يفشل الحفظ)
CREATE TABLE IF NOT EXISTS public.account_credentials (
    user_id uuid PRIMARY KEY,
    plain_password text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_credentials ENABLE ROW LEVEL SECURITY;

-- 2) دالة: هل السياسة مفعّلة؟ (آمنة وموثوقة)
CREATE OR REPLACE FUNCTION public.passwords_visible_to_managers()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (setting_value::text)::boolean
         FROM public.app_settings
         WHERE setting_key = 'show_passwords_to_managers'
         LIMIT 1),
        false
    );
$$;

-- 3) المؤسس: كل الصلاحيات (قراءة + كتابة + حذف)
DROP POLICY IF EXISTS "credentials_founder_all" ON public.account_credentials;
CREATE POLICY "credentials_founder_all"
ON public.account_credentials FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_data ud
        WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_data ud
        WHERE ud.id = auth.uid() AND ud.account_type = 'founder'
    )
);

-- 4) المدير العام: قراءة فقط إذا السياسة مفعّلة
DROP POLICY IF EXISTS "credentials_gm_read_if_allowed" ON public.account_credentials;
CREATE POLICY "credentials_gm_read_if_allowed"
ON public.account_credentials FOR SELECT
TO authenticated
USING (
    passwords_visible_to_managers()
    AND EXISTS (
        SELECT 1 FROM public.user_data ud
        WHERE ud.id = auth.uid() AND ud.account_type IN ('general_manager','founder')
    )
);

-- 5) قيمة السياسة الافتراضية: مفعّلة مؤقتاً للاختبار (غيّرها لـ 'false' بعد التأكد)
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES ('show_passwords_to_managers', 'true', now())
ON CONFLICT (setting_key) DO UPDATE SET updated_at = now();

-- 6) تصحيح: تأكد من وجود صلاحيات الجداول الأساسية
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_credentials TO authenticated;

SELECT 'Done! جدول كلمات المرور جاهز والسياسة مفعّلة للاختبار' AS status;
