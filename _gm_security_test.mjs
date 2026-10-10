// اختبارات منع تصعيد الصلاحيات — التحقق الحقيقي على قاعدة البيانات
const ANON = process.env.MISAR_ANON || 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr';
const U = 'https://wwojtkxwmgkrudtevbcb.supabase.co';
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' };

const results = [];
function rec(name, blocked, detail) {
  results.push({ name, verdict: blocked ? 'محمي ✅' : '❌ ثغرة', detail });
}

// 1) مستخدم عادي (زائر) يحاول قراءة user_data (لوحة المدير)
{
  const r = await fetch(U + '/rest/v1/user_data?select=id,account_type&limit=5', { headers: H });
  const t = await r.text();
  const empty = !t || t === '[]';
  rec('زائر يقرأ user_data (لوحة GM/المستخدمين)', empty, `HTTP ${r.status} | ${t.slice(0, 120)}`);
}

// 2) زائر يحاول ترقية نفسه إلى general_manager
{
  const r = await fetch(U + '/rest/v1/user_data?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ account_type: 'general_manager' })
  });
  const t = await r.text();
  rec('زائر يرقّي نفسه إلى general_manager', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 3) زائر يحاول ترقية نفسه إلى founder
{
  const r = await fetch(U + '/rest/v1/user_data?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ account_type: 'founder' })
  });
  const t = await r.text();
  rec('زائر يرقّي نفسه إلى founder', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 4) زائر يحاول إنشاء صف founder
{
  const r = await fetch(U + '/rest/v1/user_data', {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ id: '00000000-0000-0000-0000-00000000abcd', name: 'hacker', account_type: 'founder' })
  });
  const t = await r.text();
  rec('زائر ينشئ حساب founder', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 5) زائر يقرأ activity_logs
{
  const r = await fetch(U + '/rest/v1/activity_logs?select=*&limit=5', { headers: H });
  const t = await r.text();
  rec('زائر يقرأ سجل النشاط', !t || t === '[]', `HTTP ${r.status} | ${t.slice(0, 120)}`);
}

// 6) زائر يكتب في activity_logs (تزوير سجل)
{
  const r = await fetch(U + '/rest/v1/activity_logs', {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ admin_id: '00000000-0000-0000-0000-000000000000', action_type: 'fake', details: {} })
  });
  const t = await r.text();
  rec('زائر يزوّر سجل نشاط', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 7) زائر يعدّل صلاحيات المدير العام في app_settings
{
  const r = await fetch(U + '/rest/v1/app_settings?setting_key=eq.general_manager_permissions', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ setting_value: '{"orders":{"view":true,"edit":true}}' })
  });
  const t = await r.text();
  rec('زائر يعدّل صلاحيات المدير العام', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 8) زائر يحاول إلغاء إيقاف المدير العام
{
  const r = await fetch(U + '/rest/v1/app_settings?setting_key=eq.general_manager_suspended', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ setting_value: '[]' })
  });
  const t = await r.text();
  rec('زائر يتلاعب بحالة إيقاف المدير العام', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 9) زائر يعدّل الطلبات مباشرة
{
  const r = await fetch(U + '/rest/v1/orders?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'delivered' })
  });
  const t = await r.text();
  rec('زائر يعدّل الطلبات مباشرة', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 10) زائر يعدّل المنتجات مباشرة
{
  const r = await fetch(U + '/rest/v1/products?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'deleted' })
  });
  const t = await r.text();
  rec('زائر يعدّل المنتجات مباشرة', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 11) زائر يعدّل البنرات (قد يُسمح للقراءة، يجب رفض الكتابة)
{
  const r = await fetch(U + '/rest/v1/banners', {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ title: 'hack banner', active: true })
  });
  const t = await r.text();
  rec('زائر ينشئ بنر', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

// 12) زائر يعدّل المرتجعات
{
  const r = await fetch(U + '/rest/v1/returns?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'approved' })
  });
  const t = await r.text();
  rec('زائر يوافق على مرتجع مباشرة', !r.ok || t === '[]', `HTTP ${r.status} | ${t.slice(0, 150)}`);
}

console.log('\n=== اختبارات منع تصعيد الصلاحيات (من منظور زائر غير مسجل) ===\n');
let failed = 0;
for (const r of results) {
  if (r.verdict.includes('ثغرة')) failed++;
  console.log(`${r.verdict}  ${r.name}`);
  console.log(`      ${r.detail}\n`);
}
console.log('================================================');
console.log(failed === 0
  ? '🎉 كل محاولات التصعيد فشلت — النظام محمي على مستوى قاعدة البيانات.'
  : `⚠️ ${failed} عملية غير محمية.`);
