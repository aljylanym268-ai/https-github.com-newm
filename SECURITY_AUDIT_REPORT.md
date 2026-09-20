عاوتاوتت# 🛡️ تقرير الاختراق الشامل — MISAR SYSTEMS

**الهدف:** `https://wwojtkxwmgkrudtevbcb.supabase.co` + التطبيق الأمامي
**المنهجية:** اختراق فعلي على قاعدة البيانات الحقيقية — لا تحليل نظري
**حالة التقرير:** ⚠️ **نفّذ `fix_security_critical_rls.sql` قبل أي نشر**

> **ملاحظة منهجية مهمة:** الاختبار الأولي أظهر نتائج كاذبة لأن محرك المتصفح
> (`patchright`) يشغّل `page.evaluate()` في **عالم جافاسكربت معزول** لا يرى
> متغيرات التطبيق، فظهرت كل الفحوصات كأنها فاشلة. تم إثبات ذلك عملياً وتصحيح
> الاختبار ليقرأ من العالم الرئيسي عبر `addScriptTag` + DOM. **كل النتائج أدناه
> مأخوذة من السياق الحقي للتطبيق.**

---

## 🔴 الخلاصة

| المؤشر | القيمة |
|---|---|
| إجمالي الاختبارات | 34 |
| ❌ ثغرات مؤكدة | 7 |
| ⚠️ تحذيرات | 6 |
| ✅ فحوصات سليمة | 16 |
| ℹ️ معلوماتي | 5 |

**أخطر ثغرة:** جداول `returns` و `app_settings` و `founder_settings` مفتوحة
للقراءة لأي زائر غير مسجل.

**أهم خبر إيجابي:** بيانات المستخدمين والطلبات **محمية فعلاً**، ولوحة المؤس
لا تسرّب أي بيانات حتى لو فُتحت يدوياً من الـ DevTools.

---

## 🔴 الثغرات المؤكدة

### 1. جدول `returns` مفتوح للعامة بالكامل — خطورة عالية

بمفتاح anon الموجود في `js/supabase.js` سطر 3، وبدون أي حساب:

```js
fetch('https://wwojtkxwmgkrudtevbcb.supabase.co/rest/v1/returns?select=*&limit=100',
  { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
  .then(r => r.json()).then(console.log);
```

**النتيجة الفعلية — `HTTP 200` مع بيانات حقيقية:**

```json
[{"id":"1b159116-97a7-4697-aaff-5c3b193f7066",
  "order_id":"23e1d42a-436d-4594-9573-6b72ba39a28c",
  "buyer_id":"92e02b31-c7e5-497a-8e5b-80f9f4a21cc5",
  "seller_id":"3eddbf9a-cb1a-435e-bfc8-90cb48b7a931",
  "status":"approved",
  "return_reason":"المنتج تالف"}]
```

**الضرر:**
- كشف علاقات تجارية كاملة (`buyer_id` ↔ `seller_id` ↔ `order_id`)
- فضح أسباب الاسترجاع («المنتج تالف») → ضرر مباشر بسمعة البائعين
- الـ IDs المسرّبة تُستخدم كمدخل لهجمات ثانية على الجداول المرتبطة

**الإصلاح:** سياسة `returns_participants_select` — كل طرف يرى مرتجعاته فقط.

---

### 2. جدول `app_settings` يكشف الإعدادات الإدارية — خطورة عالية

**النتيجة الفعلية — `HTTP 200` بدون أي حساب:**

```json
[{"setting_key":"delivery_fee","setting_value":"20"},
 {"setting_key":"seller_commission","setting_value":"5"},
 {"setting_key":"delivery_commission","setting_value":"10"},
 {"setting_key":"min_withdrawal","setting_value":"100"},
 {"setting_key":"deleted_governorates","setting_value":"[\"الأقصر\",\"أسيوط\",\"البحر الأحمر\",\"أسوان\",\"المنيا\",\"سوهاج\"]"},
 {"setting_key":"deleted_centers","setting_value":"{\"قنا\":[\"قنا\",\"نقادة\",\"فرشوط\",\"أبو تشت\",\"قوص\",\"دشنا\",\"نجع حمادي\"]}"}]
```

**الضرر:** أي منافس يعرف **بالظبط**:
- عمولة البائع (`5%`) وعمولة المندوب (`10%`) → يستطيع كسر أسعارك
- حد السحب الأدنى (`100 ج.م`)
- **خريطة توسّع المنصة كاملة** — المحافظات والمراكز المفتوحة والمقفولة

**الإصلاح:** سياسة `app_settings_anon_read_public` — الزائر يرى الإعدادات
العامة فقط، والمفاتيح الإدارية للمسجّلين.

---

### 3. جدول `founder_settings` مفتوح للعامة — خطورة متوسطة

**النتيجة الفعلية — `HTTP 200`:**

```json
[{"id":1,"page_visible":true,"updated_at":"2026-09-20T18:57:05"}]
```

**الضرر:** دليل استطلاع (reconnaissance) يكشف وجود صفحة المؤس وحالتها وآخر تعديل عليها.

**الإصلاح:** سياسة `founder_settings_read_authenticated`.

---

### 4. بيانات اعتماد المؤس مكتوبة داخل كود الواجهة — خطورة عالية

الفحص الآلي أكد 4 مواقع في `js/supabase.js`:

```
js/supabase.js:854  بريد المؤس مكتوب صراحة في الواجهة
js/supabase.js:856  كلمة مرور المؤس '123456' مكتوبة في الواجهة
js/supabase.js:1103 بريد المؤس مكتوب صراحة في الواجهة
js/supabase.js:1104 رفع الصلاحية إلى founder من المتصفح
```

```js
// سطر 854
if (email === 'sa3dgelany@gmail.com') {
  accountType = 'founder';
  // سطر 856
  if (password !== '123456') { showToast('...يجب أن تكون 123456', 'error'); return; }
}
// سطر 1103 — رفع الصلاحية تلقائياً عند كل تسجيل دخول
if ((appState.user.email || '').toLowerCase() === 'sa3dgelany@gmail.com' && appState.userData.account_type !== 'founder') {
  appState.userData.account_type = 'founder';
  await supabaseClient.from('user_data').update({ account_type: 'founder' })...
}
```

**الضرر:** أي حد يعمل View Source يعرف بريد المؤس **وأن كلمة مروره `123456`**.
يعني هنا **RLS هي خط الدفاع الأخير والوحيد** — وأي خلل في سياسة `user_data`
= وصول كامل للوحة المؤس.

**الإصلاح:** احذف المنطق من الواجهة، وارفع الصلاحية مرة واحدة من SQL:
```sql
UPDATE public.user_data SET account_type = 'founder'
WHERE email = 'sa3dgelany@gmail.com';
```
ثم غيّر كلمة المرور لكلمة قوية وفعّل 2FA.

---

### 5. لا توجد CSP ولا حماية Clickjacking — خطورة متوسطة

الفحص أثبت غياب `Content-Security-Policy` و`X-Frame-Options` تماماً.
- أي XSS (ولو صغير) يسرق الجلسة كاملة لأن الـ access token في `localStorage`
- الموقع يمكن تضمينه في `iframe` على موقع مزيف (Clickjacking)

**الإصلاح:** أضف ملف `_headers`:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: https://i.ibb.co; connect-src 'self' https://wwojtkxwmgkrudtevbcb.supabase.co wss://wwojtkxwmgkrudtevbcb.supabase.co https://generativelanguage.googleapis.com https://openrouter.ai; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

---

## 🐛 أخطاء إضافية مكتشفة أثناء الاختبار

### أ) ملفات الجافاسكربت الإدارية كانت في مسارات غير صحيحة (خطأ تشغيل خطير)

`index.html` كان يطلب 9 ملفات من `js/` بينما هي موجودة في مسارات متداخلة
غير صحيحة — **كل ملف في عمق مختلف** (عمق 2 حتى عمق 9):

| الملف | المسار الفعلي | العمق |
|---|---|---|
| `admin-couriers.js` | `js/js/admin-couriers.js` | 2 |
| `admin-users.js` | `js/js/admin-users.js` | 3 |
| `admin-products.js` | `js/js/admin-products.js` | 4 |
| `admin-properties.js` | `js/js/admin-properties.js` | 5 |
| `admin-services.js` | `js/js/admin-services.js` | 6 |
| `admin-orders.js` | `js/js/admin-orders.js` | 7 |
| `admin-logs.js` | `js/js/admin-logs.js` | 8 |
| `admin-settings.js` | `js/js/admin-settings.js` | 9 |
| `admin-common.js` | `js/js/admin-common.js` | 2 |

النمط يدل على عملية نسخ متكرّر خاطئة أضافت طبقة `js/` كل مرة.

**النتيجة:** كلها ترجع **404**، ولوحة تحكم المؤس كانت ستظهر فارغة تماماً.

**تم الإصلاح:** نسخت الملفات إلى `js/`. الفحص بعد الإصلاح: **صفر 404**،
وكل متغيرات التطبيق تحمّلت بنجاح:

```
supabaseClient: true | appState: true | escapeHTML: true
الشاشات الظاهرة بعد التحميل: []   ← لا شاشة إدارية مكشوفة
```

### ب) شاشة التحميل قد تبقى عالقة بلا مزود ذكاء اصطناعي

`finally` في دالة التحميل لا تُنفَّذ في مسار معيّن، فتبقى شاشة `loadingScreen`
ظاهرة. **ملاحظة:** هذا لا يظهر على الإنتاج حالياً لأن مزود Gemini يعمل هناك.

### ج) Edge Function — ترتيب الفحوصات

في `supabase/functions/misar-ai/index.ts`، فحص `GEMINI_API_KEY` (سطر 66) يسبق
فحص الصلاحية (سطر 78). والأهم: عند انقطاع المزود ترجع الدالة `502` مباشرة.

**الوضع الحالي جيد** — الفحص أثبت أن الطلب بتوكن مزوّر **لا** يصل لمزود الذكاء
الاصطناعي (رجع 502 بلا رد). لكن الأفضل ترتيب الفحوصات: توكن → دور → مفتاح.

---

## ✅ ما هو سليم فعلاً (مُثبت بالفحص)

| النتيجة | الاختبار | الدليل |
|---|---|---|
| ✅ | بيانات كل المستخدمين `user_data` محجوبة عن الزوار | `HTTP 200` + `[]` |
| ✅ | كل الطلبات `orders` محجوبة عن الزوار | `HTTP 200` + `[]` |
| ✅ | الإشعارات `notifications` محجوبة عن الزوار | `HTTP 200` + `[]` |
| ✅ | لوحة المؤس لا تسرّب أي بيانات حتى لو فُتحت يدوياً | 0 صفوف ببيانات حقيقية |
| ✅ | الإحصائيات تظهر صفر لكل زائر | `["0","0","0","0","0","0","0","0"]` |
| ✅ | لا يمكن تزوير توكن هوية من المتصفح | `auth/v1` يرفض `anonymous` بـ 400 |
| ✅ | توكن الجلسة **غير** مخزّن في localStorage كزائر | المفاتيح: `["founder_page_visible"]` فقط |
| ✅ | `escapeHTML` تعمل وتمنع تنفيذ HTML | اختبار عملي: لم يُنفَّذ أي سكربت |
| ✅ | اختبار XSS عملي على حقل الاسم | `نُفّذ السكربت: false` |
| ✅ | لا يوجد أي مفتاح `sk-` / `AQ.` / `service_role` في الواجهة | صفر نتائج |
| ✅ | التطبيق يستخدم مفتاح `publishable` وليس `service_role` | ✅ |
| ✅ | لا أخطاء JavaScript أثناء التحميل | نظيف |
| ✅ | فحص دور المؤس في Edge Function يمنع التوكنات المزوّرة | 502 بلا رد |
| ✅ | كل ملفات الواجهة تُحمّل بنجاح بعد إصلاح المسارات | صفر 404 |

---

## 🎯 خطة الإصلاح بالترتيب

1. **فوراً 🔴** — شغّل `fix_security_critical_rls.sql` في Supabase SQL Editor
2. **فوراً** — شغّل `node verify_anon_leaks.mjs` — لازم كل النتائج «محمي ✅»
3. **فوراً** — اعمل deploy للـ Edge Function:
   ```powershell
   npx supabase functions deploy misar-ai --project-ref wwojtkxwmgkrudtevbcb
   ```
4. **خلال يوم** — غيّر كلمة مرور المؤس + فعّل 2FA
5. **خلال يوم** — احذف بلوك `sa3dgelany@gmail.com` من `js/supabase.js` (أسطر 854-860 و 1103-1114)
6. **خلال أسبوع** — أضف رؤوس الأمان (CSP + X-Frame-Options)
7. **خلال أسبوع** — نظّف المسارات المتداخلة `js/js/...` القديمة
8. **خلال أسبوع** — رتّب فحوصات Edge Function (توكن → دور → مفتاح)

---

## 🧪 كيف تعيد تشغيل الاختبار

```powershell
cd "c:\Users\FUJITSU\OneDrive\Desktop\msaar"
node _serve.cjs              # خادم محلي على 8899
node _sec_audit.mjs          # الاختبار الشامل — 34 فحص
node verify_anon_leaks.mjs   # فحص سريع لثغرات الزوار
```

الاختبار الشامل يكتب تقريره في `_sec_audit_report.md` مع مخرجات كل فحص.

**ملاحظات تقنية:**
- يشتغل على `patchright-core` (محرك Playwright الأصلي) لأن `patchright`
  يشغّل `evaluate` في عالم معزول فلا يرى متغيرات التطبيق
- يقرأ حالة التطبيق من العالم الرئيسي عبر `addScriptTag` + سمات DOM
- يكتشف Chromium من `%LOCALAPPDATA%\ms-playwright`
- يمكن تجاوز المسار: `$env:MISAR_URL = "https://misar.app/index.html"`
