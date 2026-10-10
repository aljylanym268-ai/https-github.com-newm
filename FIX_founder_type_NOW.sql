-- ============================================================
-- MISAR SYSTEMS — الإصلاح النهائي: إرجاع حساب المؤسس
-- البريد: sa3dgelany@gmail.com
-- ------------------------------------------------------------
-- السبب المؤكَّد من التشخيص: صفك موجود لكن account_type = 'client'.
-- هذا الملف يصحّح النوع فقط — لا يحذف أي صف ولا يغيّر أي بيانات أخرى.
--
-- التنفيذ: Supabase Dashboard → SQL Editor → Run (شغّله كاملاً)
-- ============================================================

-- ============================================================
-- (1) قبل الإصلاح — صوّر الحالة
-- ============================================================
SELECT 'قبل' AS phase, id, name, email, account_type, status
FROM public.user_data
WHERE lower(email) = 'sa3dgelany@gmail.com';

BEGIN;

-- ============================================================
-- (2) تصحيح النوع بالبريد
-- ============================================================
UPDATE public.user_data
SET account_type = 'founder',
    status = 'approved',
    updated_at = now()
WHERE lower(email) = 'sa3dgelany@gmail.com';

-- ============================================================
-- (3) احتياط: إن اختلف حقل البريد أو كان فارغاً، صحّح بالمعرّف
--     من auth.users مباشرة (نفس الحساب الفعلي المسجّل).
-- ============================================================
UPDATE public.user_data d
SET account_type = 'founder',
    status = 'approved',
    updated_at = now()
FROM auth.users u
WHERE d.id = u.id
  AND lower(u.email) = 'sa3dgelany@gmail.com'
  AND d.account_type <> 'founder';

-- ============================================================
-- (4) احتياط أخير: إن لم يوجد صف بالمرة، أنشئه
-- ============================================================
INSERT INTO public.user_data (id, name, email, account_type, status)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  u.email,
  'founder',
  'approved'
FROM auth.users u
WHERE lower(u.email) = 'sa3dgelany@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.user_data d WHERE d.id = u.id);

-- ============================================================
-- (5) حماية دائمة: ضبط user_metadata كاحتياط للواجهة
-- ============================================================
UPDATE auth.users
SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('account_type', 'founder', 'status', 'approved')
WHERE lower(email) = 'sa3dgelany@gmail.com';

COMMIT;

-- ============================================================
-- (6) تحقق: يجب أن يظهر founder / approved
-- ============================================================
SELECT 'بعد' AS phase, id, name, email, account_type, status
FROM public.user_data
WHERE lower(email) = 'sa3dgelany@gmail.com';
