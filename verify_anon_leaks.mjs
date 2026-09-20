// ============================================================
// تحقق سريع من ثغرات الزائر (anon) بعد تنفيذ fix_security_critical_rls.sql
// التشغيل:  node verify_anon_leaks.mjs
// المتوقع بعد الإصلاح: كل النتائج "محمي" ما عدا المنتجات (مسموحة عن قصد).
// ============================================================

const ANON = process.env.MISAR_ANON || 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr';
const URL_ = 'https://wwojtkxwmgkrudtevbcb.supabase.co';
const headers = { apikey: ANON, Authorization: 'Bearer ' + ANON };

// المحتوى الحساس الذي لا يجب أن يظهر لأي زائر
const FORBIDDEN_KEYS = [
  'deleted_governorates', 'deleted_centers', 'extra_centers',
  'seller_commission', 'delivery_commission', 'min_withdrawal',
  'return_fee', 'return_window_days', 'delivery_fee'
];

const CHECKS = [
  { name: 'بيانات المستخدمين (user_data)', url: '/rest/v1/user_data?select=id,name,email,phone,account_type&limit=3', mustBeEmpty: true },
  { name: 'الطلبات (orders)', url: '/rest/v1/orders?select=id,buyer_id,seller_id,customer_phone,shipping_address&limit=3', mustBeEmpty: true },
  { name: 'المرتجعات (returns)', url: '/rest/v1/returns?select=id,order_id,buyer_id,seller_id,status,return_reason&limit=3', mustBeEmpty: true },
  { name: 'إعدادات المؤس (founder_settings)', url: '/rest/v1/founder_settings?select=*', mustBeEmpty: true },
  { name: 'الإشعارات (notifications)', url: '/rest/v1/notifications?select=*&limit=3', mustBeEmpty: true },
  { name: 'إعدادات التطبيق (app_settings)', url: '/rest/v1/app_settings?select=setting_key,setting_value', mustBeEmpty: false, contentCheck: true },
  { name: 'المنتجات (products) — مسموحة عن قصد', url: '/rest/v1/products?select=id,name,price&limit=2', mustBeEmpty: false, allowed: true },
];

let failed = 0;

console.log('=== تحقق أمني مباشر: ماذا يستطيع زائر غير مسجل أن يقرأ؟ ===\n');

for (const c of CHECKS) {
  let status = 0, body = '';
  try {
    const r = await fetch(URL_ + c.url, { headers });
    status = r.status;
    body = await r.text();
  } catch (e) { body = 'NETWORK: ' + e.message; }

  let verdict, detail;
  if (c.allowed) {
    verdict = status === 200 && body && body !== '[]' ? 'مسموح ✅' : 'غير متاح';
    detail = `HTTP ${status} | ${body.slice(0, 120)}`;
  } else if (c.contentCheck) {
    const leaked = FORBIDDEN_KEYS.filter(k => body.includes(k));
    verdict = leaked.length ? '❌ تسريب' : 'محمي ✅';
    detail = leaked.length
      ? `مفاتيح إدارية مكشوفة للزائر: ${leaked.join(', ')}`
      : `لا يوجد أي مفتاح إداري مكشوف | HTTP ${status} | ${body.slice(0, 120)}`;
    if (leaked.length) failed++;
  } else if (c.mustBeEmpty) {
    const empty = !body || body === '[]' || body.trim() === '';
    verdict = empty ? 'محمي ✅' : '❌ تسريب';
    detail = `HTTP ${status} | ${body.slice(0, 200)}`;
    if (!empty) failed++;
  }

  console.log(`${verdict}  ${c.name}`);
  console.log(`      ${detail}\n`);
}

// اختبار الكتابة: هل يستطيع الزائر تعديل العدّادات؟
console.log('=== اختبار الكتابة من زائر غير مسجل ===\n');
try {
  const r = await fetch(URL_ + '/rest/v1/app_settings?setting_key=eq.total_visits', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ setting_value: '999' })
  });
  const txt = await r.text();
  const blocked = !r.ok || txt === '[]';
  if (!blocked) failed++;
  console.log(`${blocked ? 'محمي ✅' : '❌ تسريب'}  تعديل عدّاد الزيارات (total_visits) من زائر`);
  console.log(`      HTTP ${r.status} | ${txt.slice(0, 200)}\n`);
} catch (e) {
  console.log(`محمي ✅  تعديل عدّاد الزيارات — فشل الطلب: ${e.message}\n`);
}

console.log('================================================');
console.log(failed === 0
  ? '🎉 ممتاز: لا يستطيع أي زائر الوصول لبيانات حساسة.'
  : `⚠️ ما زال هناك ${failed} تسريب يحتاج إصلاحاً. راجع fix_security_critical_rls.sql`);
process.exit(failed === 0 ? 0 : 1);
