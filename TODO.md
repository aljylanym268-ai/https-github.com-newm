# TODO - إعدادات الإشعارات (تفعيل/تعطيل إشعارات النظام)

## الخطوات المخطط لها

- [x] إضافة حالة `notificationsEnabled` إلى `appState` في `js/supabase.js`
- [x] كتابة دالة `showNotificationSettingsModal` في `js/supabase.js`
- [x] كتابة دالة `toggleSystemNotifications` في `js/supabase.js`
- [x] كتابة دالة `sendTestNotification` في `js/supabase.js`
- [x] تعديل `showSystemNotification` لاحترام إعداد `notificationsEnabled`
- [x] تصدير الدوال الجديدة إلى `window`
- [x] إضافة عنصر قائمة "الإشعارات" في `index.html` داخل `profileScreen`
- [x] إضافة مودال `notificationSettingsModal` في `index.html`
- [x] ربط أحداث المودال في `index.html`
- [ ] اختبار تفعيل/تعطيل الإشعارات وإرسال إشعار تجريبي
