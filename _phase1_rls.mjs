// فحص سلوك RLS الحالي كزائر غير مسجل (anon) — قراءة فقط
const A = 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr';
const U = 'https://wwojtkxwmgkrudtevbcb.supabase.co';
const H = { apikey: A, Authorization: 'Bearer ' + A };

const tables = ['user_data', 'orders', 'products', 'returns', 'banners', 'app_settings', 'services', 'activity_logs', 'founder_settings', 'properties'];
console.log('=== سلوك RLS للزائر (anon) — هل يقرأ؟ ===\n');
for (const t of tables) {
  const r = await fetch(`${U}/rest/v1/${t}?select=*&limit=3`, { headers: H });
  const txt = await r.text();
  let rows = '—';
  try { const j = JSON.parse(txt); rows = Array.isArray(j) ? j.length + ' صف' : 'خطأ'; } catch (e) { rows = 'رد غير JSON'; }
  console.log(`${t.padEnd(18)} HTTP ${r.status} | ${rows} | ${txt.slice(0, 90).replace(/\n/g, ' ')}`);
}
console.log('\n=== مفاتيح app_settings المقروءة للزائر (كشف التسريب) ===\n');
const r2 = await fetch(`${U} / rest / v1 / app_settings ? select = setting_key & limit=50`, { headers: H });
const j2 = await r2.json().catch(() => []);
console.log(Array.isArray(j2) ? j2.map(x => x.setting_key).join(', ') : JSON.stringify(j2).slice(0, 300));
