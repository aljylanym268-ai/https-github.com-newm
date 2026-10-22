-- ============================================================
-- MISAR SYSTEMS — إصلاح نهائي: لوحة البائع لا تختفي بعد التعديلات
-- البريد: aljylanym268@gmail.com   (حساب بائع — ليس مؤسساً)
-- ------------------------------------------------------------
-- السبب المؤكَّد (من قراءة الكود):
--   1) عنصر "لوحة البائع" (index.html#sellerDashboardMenuItem) مخفي
--      بـ display:none، ويظهر فقط إذا:
--        account_type === 'seller' AND (status === 'approved' || status فارغ)
--      → أي خلل في أحد الحقلين يخفي اللوحة تماماً.
--   2) عند أي تعديل (الملف/العنوان/الصورة/الموقع) ينفّذ الكود
--      upsert على user_data. لو فشل أو رجع الصف غير مقروء (RLS)،
--      تسقط الواجهة على user_metadata.account_type فترجع 'client'
--      ⇒ تختفي اللوحة فوراً.
--   3) لا يوجد trigger يحمي account_type/status من أن يُصفَّرا.
--
-- ⚠️ هذا الملف يضبط الحساب كـ SELLER (بائع) وليس founder.
--    كل العمليات additive — لا حذف لأي صف.
--
-- التنفيذ: Supabase Dashboard → SQL Editor → Run (شغّل الملف كاملاً)
-- ============================================================

-- ============================================================
-- (0) قبل الإصلاح — اطبع الحالة الحقيقية
-- ============================================================
SELECT 'قبل' AS phase, d.id, d.name, d.email, d.account_type, d.status
FROM public.user_data d
WHERE lower(d.email) = 'aljylanym268@gmail.com'
   OR d.id = (SELECT u.id FROM auth.users u WHERE lower(u.email) = 'aljylanym268@gmail.com');

BEGIN;

-- ============================================================
-- (1) تصحيح النوع إلى 'seller' والحالة إلى 'approved'
--     (نلمس حقلَي النوع والحالة فقط — لا نلمس أي بيانات أخرى)
-- ============================================================
UPDATE public.user_data
SET account_type = 'seller',
    status       = 'approved'
WHERE lower(email) = 'aljylanym268@gmail.com'
  AND (account_type <> 'seller' OR status <> 'approved');

-- (1.b) احتياط: نفس التصحيح بالمعرّف من auth.users (لو حقل البريد مختلف/فارغ)
UPDATE public.user_data d
SET account_type = 'seller',
    status       = 'approved'
FROM auth.users u
WHERE d.id = u.id
  AND lower(u.email) = 'aljylanym268@gmail.com'
  AND (d.account_type <> 'seller' OR d.status <> 'approved');

-- (1.c) احتياط أخير: أنشئ الصف إن لم يوجد بالمرة
INSERT INTO public.user_data (id, name, email, account_type, status)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  u.email,
  'seller',
  'approved'
FROM auth.users u
WHERE lower(u.email) = 'aljylanym268@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.user_data d WHERE d.id = u.id);

-- ============================================================
-- (2) احتياط دائم في user_metadata — هذا هو مصدر السقوط
--     في الواجهة عند فشل قراءة user_data. نضبطه على seller.
-- ============================================================
UPDATE auth.users
SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('account_type', 'seller', 'status', 'approved')
WHERE lower(email) = 'aljylanym268@gmail.com';

-- ============================================================
-- (3) حماية حقلَي account_type و status من التصفير عند أي تعديل جزئي
--     أدوار لها لوحة: seller / delivery / founder / admin / general_manager.
--     القواعد:
--       أ) لا يُصفّر نوع الدور ولا يُحوّل إلى 'client'.
--       ب) لا تُصفّر الحالة من 'approved' إلى pending/suspended/null
--          إلا من صاحب صلاحية فعلية (مؤسس/مدير عام) أو من SQL Editor.
--     لا يعطّل أي تعديل شرعي آخر على الصف.
-- ============================================================
CREATE OR REPLACE FUNCTION public.misar_keep_protected_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  protected_roles text[] := ARRAY['seller', 'delivery', 'founder', 'admin', 'general_manager'];
  actor_is_privileged boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- هل المُعدِّل صاحب صلاحية فعلية؟ (مؤسس/مدير عام أو بلا سياق مستخدم)
  BEGIN
    actor_is_privileged := (select auth.uid()) IS NULL OR public.misar_is_founder_or_admin();
  EXCEPTION WHEN OTHERS THEN
    actor_is_privileged := (select auth.uid()) IS NULL;
  END;

  -- (أ) حماية نوع الحساب من التصفير
  IF OLD.account_type = ANY (protected_roles)
     AND (NEW.account_type IS NULL OR NEW.account_type = 'client' OR NEW.account_type = '') THEN
    NEW.account_type := OLD.account_type;   -- نُبقي الدور كما هو
  END IF;

  -- (ب) حماية الحالة: لا تُصفَّر من 'approved' إلا من صاحب صلاحية حقيقية
  IF OLD.account_type = ANY (protected_roles)
     AND COALESCE(OLD.status, 'approved') = 'approved'
     AND (NEW.status IS NULL OR NEW.status = '' OR NEW.status IN ('pending', 'suspended'))
     AND NOT actor_is_privileged THEN
    NEW.status := 'approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS misar_keep_protected_role_trigger ON public.user_data;
CREATE TRIGGER misar_keep_protected_role_trigger
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.misar_keep_protected_role();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- (4) تحقق نهائي — يجب أن يظهر seller / approved
-- ============================================================
SELECT 'بعد' AS phase, d.id, d.name, d.email, d.account_type, d.status
FROM public.user_data d
WHERE lower(d.email) = 'aljylanym268@gmail.com';

SELECT u.id, u.email,
       u.raw_user_meta_data ->> 'account_type' AS meta_account_type,
       d.account_type                          AS db_account_type,
       d.status                                AS db_status
FROM auth.users u
LEFT JOIN public.user_data d ON d.id = u.id
WHERE lower(u.email) = 'aljylanym268@gmail.com';
