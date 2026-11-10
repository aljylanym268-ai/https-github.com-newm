-- ============================================================
-- إضافة عمود sort_order لجدول products
-- يسمح للمؤسس بترتيب المنتجات (مين يظهر الأول ومين في الآخر)
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor
-- ============================================================

-- 1) إضافة العمود (لو مش موجود)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 2) تعبئة القيم الحالية تلقائياً حسب تاريخ الإنشاء (الأحدث = ترتيب 0 = يظهر الأول)
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1 AS rn
    FROM products
)
UPDATE products SET sort_order = ranked.rn
FROM ranked WHERE products.id = ranked.id;

-- 3) فهرس لتسريع الترتيب
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products (sort_order);

-- 4) السماح للمستخدمين المسجلين بتحديث الترتيب (RLS)
-- إذا كان عندك policy عام تسمح بالـ update نحصل على خطأ لاكثر من policy ب نفس الاسم
DROP POLICY IF EXISTS "allow_sort_order_update" ON products;

CREATE POLICY "allow_sort_order_update"
ON products FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

SELECT 'Done! عمود sort_order جاهز' AS status;
