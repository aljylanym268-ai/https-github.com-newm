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
