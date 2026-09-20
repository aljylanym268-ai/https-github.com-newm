# تشغيل المساعد الذكي MISAR AI - دليل كامل

## الحالة الحالية: ✅ مؤمّن عبر الخادم
- تم حذف المفاتيح الثابتة من `getMisarApiKey` و `getMisarGeminiKey` — لا مفتاح مكشوف في الكود الأمامي
- أولوية الاتصال: Edge Function (الخادم) أولاً، ثم مفتاح المستخدم المحلي إن وُجد
- إذا فشل الخادم، يمكن للمستخدم إدخال مفتاحه الخاص عبر الشات (للاستخدام الشخصي)
- المفاتيح لم تعد تظهر في الكود المصدري أو أدوات المطور

## ما تم إنجازه
- المساعد موجود بالكامل في المشروع: `js/misar-ai.js` (الواجهة) + `supabase/functions/misar-ai/index.ts` (الخادم)
- تم اختبار Edge Function على Supabase → يرجع 500 لأن السر OPENAI_API_KEY غير مضبوط على السيرفر
- تم تثبيت Deno وإنشاء نسخة محلية: `supabase/functions/misar-ai/local.ts`
- تم اختبار التشغيل المحلي بنجاح: الدالة تعمل وترد `OPENAI_API_KEY is not configured` حتى يُضاف المفتاح

## لماذا لا يعمل الآن؟
الدالة تحتاج مفتاح OpenAI محفوظ كسر (Secret).

## الحل الأساسي: ضبط سر Gemini على Supabase
```powershell
cd "c:\Users\FUJITSU\OneDrive\Desktop\msaar"
npx supabase login          # افتح الرابط وسجل دخولك، ثم الصق الرمز في الترمينال
npx supabase secrets set GEMINI_API_KEY=AQ.xxxxxxxxxxxx --project-ref wwojtkxwmgkrudtevbcb
```

## تسلسل عمل المساعد الآن
1. Edge Function على Supabase (لو ضُبط مفتاح OpenAI عليه)
2. **Google Gemini مباشرة من المتصفح** ← هذا يعمل حالياً ✅
3. مفتاح OpenAI محلي (sk-) إن وُجد
4. بحث محلي في المنتجات من قاعدة البيانات

## تحديث لاحقاً
تم نقل المفتاح إلى Edge Function بسرّ Gemini:
```
supabase secrets set GEMINI_API_KEY=... --project-ref wwojtkxwmgkrudtevbcb
```
1) اعمل ملف `.env` (لا ترفعه لـ GitHub) واكتب فيه:
```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxx
```
2) شغّل:
```powershell
$env:OPENAI_API_KEY=(Get-Content .env | Select-String "OPENAI_API_KEY").Line.Split("=")[1]
& "$env:USERPROFILE\.deno\bin\deno.exe" run --allow-all supabase/functions/misar-ai/local.ts
# يشتغل على http://localhost:8000
```

## تحويل الموقع للسيرفر المحلي مؤقتاً
في `js/misar-ai.js` غيّر سطر edgeFunctionUrl إلى `'http://localhost:8000'` (وأرجعه قبل النشر).

## طريقة العمل حالياً بدون مفتاح سيرفر
المساعد يطلب من المستخدم إدخال مفتاح يبدأ بـ sk- داخل الشات ويُحفظ في localStorage.

## ملاحظات أمان
- لا ترفع أي مفتاح حقيقي إلى GitHub.
- الأفضل استخدام Edge Function مع السر على Supabase فقط.

---

# 🏛️ وضع المؤس (Founder Mode)

المساعد الذكي بقى له **وضع مؤسس** يتبدّل تلقائياً حسب `account_type` في `user_data`.
المؤس يشوف إحصائيات المنصة كاملة، وأي مستخدم عادي يشوف واجهته القديمة بالضبط.

## إزاي بيشتغل
1. عند `loadUserData()` في `js/supabase.js`:
   - `account_type === 'founder'` → `setMisarFounderMode(true)`
   - غير كده → `setMisarFounderMode(false)` (وكمان عند تسجيل الخروج)
2. حسب الوضع، المساعد يختار:
   - **سياق المنصة** `buildMisarFounderContext()` بدل سياق المستخدم `buildMisarContext()`
   - **برومبت إداري** `MISAR_FOUNDER_SYSTEM_PROMPT` بدل برومبت المستخدم
   - **اقتراحات إدارية** في الشات عبر `renderMisarAiSuggestions()`

## الأرقام اللى المساعد يعرفها في وضع المؤس
| المجال | التفاصيل |
|---|---|
| المستخدمون | إجمالي + عملاء/بائعين/مناديب + حالات المناديب (قيد المراجعة/معتمد/موقوف) |
| الطلبات | إجمالي + معلّقة + في التوصيل + مكتملة + آخر 7 أيام + قيمة المُسلّم |
| المنتجات | إجمالي + حسب الحالة + منتهية المخزون |
| المرتجعات | العدد الإجمالي |
| البلاغات | البلاغات المفتوحة (pending) |
| العقارات والخدمات | الأعداد |
| النشاط | المتصلون الآن + زيارات اليوم + إجمالي الزيارات |

> الأرقام لقطة لحظية وقت السؤال، ومصدرها نفس جداول لوحة تحكم المؤس (بتحترم RLS).

## حل احتياطي ذكي (بدون أي API)
لو فشلت كل مزودات الذكاء الاصطناعي (Edge Function + مفتاح المستخدم)،
المساعد في وضع المؤس يرد بـ **تقرير مبني على الأرقام الحقيقية** من `tryFounderReportAnswer()`:
ملخص المنصة، الطلبات، المناديب، المرتجعات، البلاغات، المتصلون، المنتجات، وتوصيات.

ده مهم لأن الردود الثابتة القديمة كانت موجّهة للمشتري ومش مفيدة للمؤس.

## الأمان: التحقق من الدور على الخادم
`supabase/functions/misar-ai/index.ts` بيستقبل الآن حقل `mode`:

```json
{ "messages": [], "mode": "founder" }
```

- لو `mode === "founder"`: الدالة تتحقق من التوكن عبر `admin.auth.getUser()`
  ثم تقرأ `user_data.account_type` بمفتاح service role.
- مسموح فقط بـ `founder` أو `admin`، وإلا ترجع **403 founder mode not allowed**.
- يعني المستخدم ما يقدرش ينتحل دور المؤس من المتصفح حتى لو عدّل الجافاسكربت.

### متغيرات البيئة المطلوبة على Edge Function
| السر | الغرض | الحالة |
|---|---|---|
| `GEMINI_API_KEY` | مفتاح Gemini للذكاء الاصطناعي | مطلوب |
| `SUPABASE_URL` | للاتصال بـ admin client | تلقائي على Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | للتحقق من الدور | تلقائي على Supabase |

`SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` متاحين تلقائياً في Edge Functions على Supabase —
مش محتاج تضيفهم يدوياً إلا لو بتشغل محلياً.

## النشر
```powershell
cd "c:\Users\FUJITSU\OneDrive\Desktop\msaar"
npx supabase functions deploy misar-ai --project-ref wwojtkxwmgkrudtevbcb
```

### تشغيل محلي
```powershell
$env:GEMINI_API_KEY="AQ.xxxx"
$env:SUPABASE_URL="https://wwojtkxwmgkrudtevbcb.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # مطلوب لاختبار وضع المؤس
& "$env:USERPROFILE\.deno\bin\deno.exe" run --allow-all supabase/functions/misar-ai/local.ts
```

## اختبار سريع
1. سجّل دخول بحساب المؤس → افتح شات المساعد.
2. اسأل: «إيه ملخص حالة المنصة النهاردة؟» → لازم يرجع أرقام حقيقية.
3. اسأل: «إيه أهم حاجة المفروض أركز عليها دلوقتي؟» → لازم يرجع توصيات.
4. سجّل دخول بحساب عميل → الشات يرجع للواجهة والاقتراحات العادية.
5. للتأكد من الأمان: من كونسول المتصفح بحساب عميل، اطلب `mode: 'founder'` → المتوقع **403**.

## ملفات معدّلة
- `js/misar-ai.js` — برومبت المؤس، سياق المنصة، التقارير المحلية، الاقتراحات
- `js/supabase.js` — ربط `setMisarFounderMode` بـ `loadUserData` و `logout`
- `supabase/functions/misar-ai/index.ts` — `mode: "founder"` + `verifyFounderRole()`
