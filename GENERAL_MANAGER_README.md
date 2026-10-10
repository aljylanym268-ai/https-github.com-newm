# نظام General Manager — MISAR SYSTEMS

## الترتيب الإداري

```
founder  (أعلى صلاحية مطلقة)
   ↓
general_manager  (المدير العام — تحت المؤسس)
   ↓
seller / delivery / client  (باقي الحسابات)
```

---

## 🔴 خطوة إلزامية واحدة قبل الاستخدام

نظام الصلاحيات **لا يعمل فعلياً** حتى تُنفَّذ إعدادات قاعدة البيانات (RLS + الدوال + حماية المؤسس).

### الطريقة (أ) — Supabase Dashboard
1. افتح مشروعك في [Supabase](https://supabase.com) → **SQL Editor**.
2. الصق محتوى الملف `general_manager_system.sql`.
3. اضغط **Run**.

### الطريقة (ب) — Supabase CLI
```powershell
cd "c:\Users\FUJITSU\OneDrive\Desktop\msaar"
npx supabase db push
```

> الملف آمن وإعادة تشغيله لا تضر (Idempotent). لا يحذف جداول ولا بيانات، ولا يمس حساب المؤسس.

### التحقق بعد التنفيذ
شغّل فحص الثغرات:
```powershell
node _gm_security_test.mjs
```
المتوقع: **كل النتائج «محمي ✅»**.

---

## 🧭 كيف يدخل المؤسس إلى إدارة المدير العام؟

1. سجّل الدخول بحسابك (`account_type = 'founder'` في `user_data`).
2. من القائمة → **لوحة تحكم المؤسس**.
3. تبويب **«المدير العام»** (أيقونة `user-tie`).
4. من هناك:
   - أدخل بريد مستخدم → **تعيين مدير عام**.
   - **إيقاف / تفعيل** المدير.
   - تعديل **صلاحياته** (شبكة الأقسام × الإجراءات) — تُطبَّق فوراً.
   - **النشاط** لمشاهدة سجله.
   - **تغيير الدور** أو **إلغاء التعيين**.

## 🧭 كيف يدخل المدير العام إلى لوحته؟

1. سجّل الدخول بحساب `account_type = 'general_manager'` وحالته غير موقوفة.
2. من القائمة → **لوحة المدير العام**.
3. تظهر فقط التبويبات التي يملك فيها صلاحية `view`.
4. أي محاولة لفتح قسم غير مسموح → رفض (واجهة + قاعدة بيانات).

---

## 🔒 الصلاحيات المتاحة (14 قسماً)

| القسم | الإجراءات |
|---|---|
| نظرة عامة `dashboard` | view |
| الطلبات `orders` | view / create / edit / delete |
| المنتجات `products` | view / create / edit / delete |
| الخدمات `services` | view / create / edit / delete |
| المستخدمون `users` | view / edit |
| البائعون `sellers` | view / edit |
| المندوبون `delivery` | view / edit |
| المرتجعات `returns` | view / edit |
| الإعلانات `ads` | view / edit |
| البنرات `banners` | view / edit |
| المواقع `locations` | view / edit |
| التقارير `reports` | view |
| سجل النشاط `activity_logs` | view |
| الإعدادات `settings` | view / edit |

**افتراضياً:** المدير العام يملك `view` لمعظم الأقسام، و**لا يملك** أي `edit` أو `delete` حتى تمنحه أنت إياها.

---

## 🚫 ما لا يستطيع المدير العام فعله (مفروض في قاعدة البيانات)

- تعديل / حذف / تعطيل حساب المؤسس.
- تغيير المؤسس إلى أي دور.
- ترقية نفسه (أو غيره) إلى `founder`.
- إنشاء حساب مؤسس.
- تعديل صلاحياته بنفسه أو إلغاء إيقافه.
- تجاوز الحماية عبر DevTools (لأن RLS يرفض على مستوى DB).
- الوصول إلى Secrets / API Keys.

---

## 🧩 الملفات

| الملف | الدور |
|---|---|
| `general_manager_system.sql` | SQL الأمان الأساسي (RLS + دوال + Trigger حماية المؤسس) |
| `supabase/migrations/20261007_general_manager_system.sql` | نفس الملف كـ migration للـ CLI |
| `js/general-manager.js` | منطق المدير العام + الصلاحيات + لوحة المؤسس |
| `_gm_security_test.mjs` | فحص منع تصعيد الصلاحيات |

## ⚙️ الإعدادات المخزَّنة (في `app_settings`)

| المفتاح | الوصف |
|---|---|
| `general_manager_permissions` | JSON بصلاحيات المدير العام |
| `general_manager_suspended` | JSON بمصفوفة UUID المدراء الموقوفين |
| `general_manager_sections` | محجوز للأقسام (اختياري) |

كلها **يكتبها المؤسس فقط** — الـ RLS يمنع المدير العام من لمسها.
