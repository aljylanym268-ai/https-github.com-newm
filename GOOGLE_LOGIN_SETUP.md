# إعداد تسجيل الدخول عبر Google (Supabase OAuth)

هذا الملف يوثّق الإعدادات المطلوبة من جهة **Supabase** و**Google Cloud** حتى يعمل زر
«التسجيل عبر Google» في شاشة التسجيل بشكل صحيح.

---

## 1. الإعداد في Google Cloud Console

1. ادخل إلى [Google Cloud Console](https://console.cloud.google.com/) وأنشئ مشروعاً (أو اختر مشروعاً قائماً).
2. من القائمة الجانبية: **APIs & Services → OAuth consent sheet** (شاشة الموافقة):
   - نوع المستخدم: **External**.
   - أدخل اسم التطبيق، بريد الدعم، بيانات المطوّر.
   - في قسم **Scopes** تأكد من وجود: `userinfo.email`, `userinfo.profile`, `openid`.
   - أضف بيانات الاختبار (Test users) أثناء وضع الاختبار إن لزم.
3. من: **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - نوع التطبيق: **Web application**.
   - **Authorized JavaScript origins**:
     ```
     https://<PROJECT_REF>.supabase.co
     http://localhost:3000        (للتطوير المحلي)
     https://<نطاق_الموقع_الإنتاجي>
     ```
   - **Authorized redirect URIs** (مهم جداً — يجب أن يطابق تماماً):
     ```
     https://<PROJECT_REF>.supabase.co/auth/v1/callback
     ```
4. انسخ **Client ID** و**Client Secret**.

> ملاحظة: رابط إعادة التوجيه (redirect URI) يكون دائماً على نطاق Supabase وليس على نطاق موقعك،
> لأن Supabase هو الوسيط الذي يتولّى تبادل الكود مع Google ثم يعيد التوجيه إلى موقعك.

---

## 2. الإعداد في Supabase Dashboard

1. ادخل إلى [Supabase Dashboard](https://app.supabase.com/) → اختر المشروع.
2. من: **Authentication → Providers → Google**:
   - فعّل المزوّد (**Enable**).
   - الصق **Client ID** و**Client Secret** من الخطوة السابقة.
   - احفظ.
3. من: **Authentication → URL Configuration**:
   - **Site URL**: ضع نطاق الموقع الإنتاجي، مثال:
     ```
     https://<نطاق_الموقع_الإنتاجي>
     ```
   - **Redirect URLs** (أضف كل ما قد يعود إليه المستخدم):
     ```
     https://<نطاق_الموقع_الإنتاجي>/**
     http://localhost:3000/**
     ```
   > بدون إضافة الرابط هنا، سيرفض Supabase العودة إلى موقعك ويظهر خطأ
   > `redirect_uri_mismatch` أو يعود المستخدم إلى Site URL الافتراضي.
4. تأكد أن **Auth → Settings → Security** لا يفرض قيوداً تمنع OAuth (مثل تعطيل التسجيل الجديد
   إذا كنت تحتاج حسابات جديدة من Google).

---

## 3. الإعداد في الكود (تم بالفعل)

| العنصر | الموقع | الوصف |
| --- | --- | --- |
| `signInWithGoogle()` | `js/supabase.js:649` | تبدأ OAuth مع Google عبر `signInWithOAuth`، مع `redirectTo` نظيف و`prompt: select_account`، ومعالجة أخطاء + مؤشّر تحميل. |
| `applyPendingAccountType()` | `js/supabase.js:709` | تكتب نوع الحساب (`client` / `seller` / `delivery`) المختار قبل التسجيل إلى جدول `user_data` بعد العودة من Google. لا تُرقّي أبداً إلى `founder` / `general_manager` / `admin`. |
| زر Google | `index.html` (شاشة التسجيل) | يستدعي `signInWithGoogle` ويلتقط `pendingAccountType` من حقل `registerAccountType`. |
| استعادة الجلسة | `index.html:1609` | بعد `getSession` يُستدعى `applyPendingAccountType()` ثم تُعاد `loadUserData()`. |
| تغيّر حالة المصادقة | `index.html:1747` | في `onAuthStateChange` عند `SIGNED_IN` يُستدعى `applyPendingAccountType()`. |

---

## 4. قائمة تحقق قبل الاختبار

- [ ] تم تفعيل مزوّد Google في Supabase مع Client ID / Secret الصحيحين.
- [ ] رابط `https://<PROJECT_REF>.supabase.co/auth/v1/callback` مُضاف في Google كمُعاد توجيه مصرّح.
- [ ] نطاق الموقع الإنتاجي مُضاف في Supabase → URL Configuration (Site URL + Redirect URLs).
- [ ] نطاق الموقع الإنتاجي مُضاف في Google → Authorized JavaScript origins.
- [ ] اتصال الإنترنت يعمل (OAuth يحتاج اتصالاً بالإنترنت، بخلاف تشغيل التطبيق محلياً).

---

## 5. أخطاء شائعة وحلولها

| الخطأ | السبب المحتمل | الحل |
| --- | --- | --- |
| `redirect_uri_mismatch` | رابط إعادة التوجيه غير مُصرّح في Google | أضف `https://<PROJECT_REF>.supabase.co/auth/v1/callback` كما هو تماماً |
| `Unsupported provider: provider is not enabled` | مزوّد Google غير مُفعّل في Supabase | فعّله من Authentication → Providers → Google |
| عودة المستخدم إلى صفحة بيضاء / Site URL | الرابط غير مُضاف في Redirect URLs | أضف `https://<نطاق_الموقع>/**` |
| التحويل إلى «عميل» عند كل دخول | كتابة نوع الحساب في مسار الدخول | تحقّق أن `signInWithGoogle` تُفرّغ `pendingAccountType` في مسار الدخول (مطبّق حالياً) |
| ظهور خطأ OAuth في الرابط | إلغاء الموافقة أو رفض الصلاحية | تنظيف الرابط يتم تلقائياً في أعلى `js/supabase.js` ويعرض رسالة Toast |

---

## 6. اختبار تسجيل الدخول عبر Google

اختبر السيناريوهات الثلاثة التالية، ولاحظ أن نوع الحساب يُحفظ في `user_data` ولا يتحول إلى «عميل»:

### أ) عميل (client)
1. افتح الموقع → شاشة التسجيل → اختر «عميل» → اضغط «التسجيل عبر Google».
2. أكمل الموافقة في Google.
3. بعد العودة: تحقق أن المستخدم يصل إلى الشاشة الرئيسية (`homeScreen`) وأن `account_type = client`.

### ب) بائع (seller)
1. نفس الخطوات مع اختيار «بائع».
2. بعد العودة: يجب أن يظهر حساب البائع بحالة `approved` وأن يصل إلى لوحة البائع (`sellerDashboardScreen`).

### ج) مندوب (delivery)
1. نفس الخطوات مع اختيار «مندوب».
2. بعد العودة: يجب أن يكون `account_type = delivery` و`status = pending` حتى تتم الموافقة عليه،
   ويصل المستخدم إلى لوحة المندوب (`deliveryDashboardScreen`).

> للتأكد من القيم المخزّنة، نفّذ في SQL Editor:
> ```sql
> select id, name, account_type, status from public.user_data order by created_at desc limit 5;
> ```
