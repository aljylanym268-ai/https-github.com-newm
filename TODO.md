# TODO - إصلاح تسجيل الدخول عبر Google

## الخطوات المخطط لها

- [x] تحليل المشكلة (فهم الكود الحالي)
- [x] تحسين دالة `signInWithGoogle` في `js/supabase.js` (إضافة loading + معالجة أخطاء)
- [x] إضافة دالة `applyPendingAccountType` في `js/supabase.js` وتصديرها
- [x] إضافة زر "التسجيل عبر Google" في شاشة التسجيل في `index.html`
- [x] استدعاء `applyPendingAccountType` عند استعادة الجلسة (`getSession`) في `index.html`
- [x] استدعاء `applyPendingAccountType` في `onAuthStateChange` (SIGNED_IN) في `index.html`
- [x] إضافة مستمع حدث لزر Google في شاشة التسجيل
- [ ] توثيق إعدادات Supabase / Google المطلوبة في الخادم
- [ ] اختبار تسجيل الدخول عبر Google (عميل / بائع / مندوب)

