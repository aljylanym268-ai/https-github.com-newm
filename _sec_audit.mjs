﻿// ============================================================
// MISAR SYSTEMS — اختبار أمني شامل (من منظور مهاجم)
// يفتح التطبيق في متصفح حقي ويحاول اختراقه فعلياً، ثم يطبع تقريراً.
// التشغيل:  node _sec_audit.mjs
// المتطلبات: خادم محلي على 8123 (انظر أسفل) + Chromium من إضافة DSCodeGPT
// ============================================================

import { createRequire } from 'node:module';
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

// ---------- إعدادات ----------
const PORT = process.env.MISAR_PORT || '8899';
const BASE = process.env.MISAR_URL || `http://localhost:${PORT}/index.html`;
const SUPABASE_ANON = process.env.MISAR_ANON || 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr';
const SUPABASE_URL = 'https://wwojtkxwmgkrudtevbcb.supabase.co';
const EDGE_AI = SUPABASE_URL + '/functions/v1/misar-ai';
const OUT_LOG = '_sec_audit_report.md';

// ---------- أدوات ----------
const results = [];
function record(group, name, verdict, detail, severity = 'info') {
  results.push({ group, name, verdict, detail: String(detail ?? '').slice(0, 900), severity });
  const icon = verdict === 'PASS' ? '✅' : verdict === 'FAIL' ? '❌' : verdict === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`${icon} [${group}] ${name}`);
  console.log(`     ${String(detail ?? '').slice(0, 300)}`);
}
const PASS = 'PASS', FAIL = 'FAIL', WARN = 'WARN', INFO = 'INFO';

function resolveChromium() {
  const base = join(homedir(), '.vscode/extensions');
  const dirs = readdirSync(base).filter(d => d.startsWith('danielsanmedium.dscodegpt-')).sort();
  if (!dirs.length) throw new Error('لم أجد إضافة DSCodeGPT لتشغيل Chromium');
  const root = join(base, dirs[dirs.length - 1], 'standalone') + '/';
  // نستخدم patchright-core لأن patchright يشتغل في عالم معزول فيخفي متغيرات الصفحة
  const req = createRequire(root);
  let mod;
  try { mod = req('patchright-core'); } catch { mod = req('patchright'); }
  return mod.chromium ?? mod.default?.chromium ?? mod.chromium;
}

// ============================================================
// قراءة متغيرات التطبيق من العالم الرئيسي للصفحة
// patchright يشغّل page.evaluate() في عالم معزول لا يرى متغيرات
// التطبيق، لذلك ننفّذ الكود كـ <script> حقي في الصفحة ونقرأ النتيجة من DOM.
// ============================================================
async function mainWorld(page, fnBody, arg) {
  const token = 'pw_' + Math.random().toString(36).slice(2);
  const wrapped = `
    (async () => {
      try {
        const out = await (async () => { ${fnBody} })(${JSON.stringify(arg ?? null)});
        document.body.setAttribute('data-${token}', 'OK:' + encodeURIComponent(JSON.stringify(out ?? null)));
      } catch (e) {
        document.body.setAttribute('data-${token}', 'ERR:' + encodeURIComponent(String(e && e.message || e)));
      }
    })();
  `;
  await page.addScriptTag({ content: wrapped });
  await page.waitForFunction(
    (t) => document.body.hasAttribute('data-' + t), token, { timeout: 20000 }
  ).catch(() => {});
  const raw = await page.getAttribute('body', 'data-' + token);
  await page.evaluate((t) => document.body.removeAttribute('data-' + t), token).catch(() => {});
  if (!raw) return { __timeout: true };
  const [status, payload] = raw.split(/:(.*)/s);
  if (status === 'ERR') return { __error: decodeURIComponent(payload || '') };
  try { return JSON.parse(decodeURIComponent(payload || 'null')); }
  catch { return { __raw: decodeURIComponent(payload || '') }; }
}

// مسار Chromium المتاح فعلياً على الجهاز (الإصدار المتوفر في ms-playwright)
function chromiumExecutable() {
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  try {
    const dirs = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort();
    if (!dirs.length) return undefined;
    return join(base, dirs[dirs.length - 1], 'chrome-win64', 'chrome.exe');
  } catch { return undefined; }
}

async function ensureServer() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(BASE, { signal: ctrl.signal });
    if (r.ok) { console.log(`ℹ️  خادم محلي شغال بالفعل على ${PORT}`); return null; }
  } catch { /* لا يوجد خادم */ }
  console.log(`ℹ️  بشغّل خادم محلي مؤقت على ${PORT}...`);
  let p = spawn(process.execPath, ['_serve.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  p.stdout.on('data', d => { logs += d.toString(); });
  p.stderr.on('data', d => { logs += d.toString(); });
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 1200);
      const r = await fetch(BASE, { signal: ctrl.signal });
      if (r.ok) { console.log(`ℹ️  الخادم المحلي اشتغل على ${PORT}`); return p; }
    } catch { /* لسه بيقوم */ }
  }
  console.warn('⚠️ تعذر تشغيل الخادم المحلي:\n' + logs.slice(0, 800));
  return p;
}

// ---------- أسئلة الاختبار ----------
const LOGIN_QUERIES = [
  ['قراءة حساب المؤس بالبريد والباسورد الضعيف', `select=id,name,email,phone,account_type,status&email=eq.sa3dgelany@gmail.com`],
  ['سحب كل صفوف user_data (بيانات كل المستخدمين)', 'select=id,name,email,phone,address,center&limit=5'],
  ['سحب كل الطلبات', 'select=id,buyer_id,seller_id,customer_phone,shipping_address&limit=5'],
  ['سحب رسائل الإشعارات', 'select=*&limit=3'],
  ['سحب الإعدادات (app_settings)', 'select=*&limit=10'],
  ['سحب إعدادات المؤس (founder_settings)', 'select=*&limit=5'],
  ['سحب المنتجات (مسموح عن قصد — كتالو عام)', 'select=id,name,price&limit=3'],
  ['سحب المرتجعات', 'select=*&limit=3'],
];

async function directRestProbe(table, query, headers) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 600) };
  } catch (e) {
    return { status: 0, body: 'NETWORK ERROR: ' + e.message };
  }
}

// ============================================================

(async () => {
  const server = await ensureServer();
  const anonHeaders = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON };

  console.log('\n===== (1) اختبار مباشر على واجهة Supabase REST كزائر غير مسجل =====\n');
  for (const [name, q] of LOGIN_QUERIES) {
    const table = name.includes('الطلبات') ? 'orders'
      : name.includes('user_data') ? 'user_data'
        : name.includes('الإشعارات') ? 'notifications'
          : name.includes('app_settings') ? 'app_settings'
            : name.includes('founder_settings') ? 'founder_settings'
              : name.includes('المنتجات') ? 'products'
                : name.includes('المرتجعات') ? 'returns'
                  : 'user_data';
    const res = await directRestProbe(table, q, anonHeaders);
    const leaked = res.status === 200 && res.body && res.body !== '[]';
    const isIntentionallyPublic = table === 'products';
    record('REST-ANON', name, isIntentionallyPublic ? INFO : (leaked ? FAIL : PASS),
      `HTTP ${res.status} | ${res.body ? res.body.slice(0, 200) : '(فارغ)'}`,
      leaked && !isIntentionallyPublic ? 'critical' : 'info');
  }

  // ---------- المحرك ----------
  const chromium = resolveChromium();
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__MISAR_AUDIT = true; });

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) consoleErrors.push('CONSOLE: ' + m.text().slice(0, 200));
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(8000);

  // ===== (2) الحالة الابتدائية =====
  console.log('\n===== (2) الحالة الابتدائية بعد التحميل =====\n');
  const initial = await mainWorld(page, `
    return {
      screenCount: document.querySelectorAll('.screen').length,
      loadingVisible: (() => { const l = document.getElementById('loadingScreen'); return l ? getComputedStyle(l).display !== 'none' : false; })(),
      visibleScreens: [...document.querySelectorAll('.screen')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id),
      hasSupabaseClient: typeof supabaseClient === 'object',
      hasAppState: typeof appState === 'object',
      hasEscapeHTML: typeof escapeHTML === 'function',
      supabaseUrlExposed: typeof SUPABASE_URL === 'string' ? SUPABASE_URL : null,
      anonKeyIsPublishable: typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.startsWith('sb_publishable_'),
    };
  `);
  record('INIT', 'عدد الشاشات في الصفحة', INFO, String(initial.screenCount));
  record('INIT', 'التطبيق اكتمل تحميله (المتغيرات الأساسية موجودة)',
    (initial.hasSupabaseClient && initial.hasAppState && initial.hasEscapeHTML) ? PASS : FAIL,
    `supabaseClient: ${initial.hasSupabaseClient} | appState: ${initial.hasAppState} | escapeHTML: ${initial.hasEscapeHTML}`);
  record('INIT', 'يستخدم مفتاح publishable وليس service_role',
    initial.anonKeyIsPublishable ? PASS : FAIL,
    `SUPABASE_ANON_KEY تبدأ بـ sb_publishable_: ${initial.anonKeyIsPublishable}`);
  record('INIT', 'الشاشات الظاهرة بعد التحميل', initial.visibleScreens.length <= 2 ? PASS : FAIL,
    JSON.stringify(initial.visibleScreens));
  // لو المفتاح مش مضبوط على الخادم ولا يوجد مفتاح Gemini عند الزائر،
  // finally في التطبيق مش بتتنفّذ وقد تبقى شاشة التحميل ظاهرة (سلوك فعلي).
  record('INIT', 'شاشة التحميل اختفت', initial.loadingVisible ? WARN : PASS,
    initial.loadingVisible
      ? 'لا زالت ظاهرة (بلا مزود ذكاء اصطناعي؛ في حالة وجود مزود تعمل الشاشة طبيعياً)'
      : 'اختفت');

  // ===== (3) هل شاشة لوحة المؤس موجودة في HTML كزائر؟ =====
  console.log('\n===== (3) كشف محتوى لوحة تحكم المؤس من HTML نفسه =====\n');
  const founderDom = await mainWorld(page, `
    const el = document.getElementById('founderDashboardScreen');
    if (!el) return { exists: false };
    return {
      exists: true,
      htmlLength: el.innerHTML.length,
      tableHeaders: [...el.querySelectorAll('th')].map(t => t.textContent.trim()).slice(0, 12),
      buttons: [...el.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 10),
      // الصفوف المرسومة فعلياً بالبيانات = الصفوف التي تحتوي عناصر جدول حقيقية (وليس قوالب HTML الثابتة)
      // الصفوف الحقيقية = صفوف بها خلايا تحمل نصاً فعلياً وليس العنصر النائب
      renderedDataRows: [...el.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td') && tr.textContent.trim() && tr.textContent.trim() !== 'جاري التحميل...').length,
      placeholderRows: [...el.querySelectorAll('tbody tr')].filter(tr => tr.textContent.trim() === 'جاري التحميل...').length,
      statValues: [...el.querySelectorAll('.stat-number')].map(s => s.textContent.trim()),
    };
  `);
  record('DOM-EXPOSURE', 'شاشة لوحة المؤس متضمنة في HTML (مشروطة بالعميل)',
    founderDom.exists ? WARN : PASS,
    founderDom.exists
      ? `الواجهة كاملة موجودة في HTML (${founderDom.htmlLength} حرف) — لكنها مجرد هيكل بلا بيانات. Tabs: ${founderDom.tableHeaders.join(' | ') || '(بدون رؤوس)'}`
      : 'غير موجودة');
  record('DOM-EXPOSURE', 'هل وُجدت أى بيانات حقيقية مكتوبة داخل اللوحة بدون تسجيل دخول؟',
    (founderDom.renderedDataRows || 0) > 0 ? FAIL : PASS,
    `صفوف بها بيانات حقيقية: ${founderDom.renderedDataRows} | صفوف نائبة: ${founderDom.placeholderRows} | أرقام الإحصائيات: ${JSON.stringify(founderDom.statValues)}`);

  // ===== (4) تنفيذ السكربت من كونسول مهاجم (XSS / تجاوز الواجهة) =====
  console.log('\n===== (4) تنفيذ جافاسكربت من الكونسول كزائر (تجاوز الواجهة) =====\n');
  const escalation = await mainWorld(page, `
    const out = {};
    // نسجّل الدوال الموجودة فعلاً قبل أي تعديل
    out.globalsAvailable = ['showScreen', 'loadFounderStats', 'loadPendingDeliveries', 'displayAllDeliveryPersons', 'loadGlobalFounderVisibility', 'initFounderSettings']
      .filter(n => typeof window[n] === 'function');
    // 4.1: تعديل الحساب محلياً
    try {
      window.appState = window.appState || {};
      appState.user = { id: 'attacker', email: 'attacker@evil.com' };
      appState.userData = { account_type: 'founder', status: 'approved', name: 'Hacker' };
      out.localForge = 'appState اتعدّل بنجاح (as expected — مش حماية حقيقية)';
    } catch (e) { out.localForge = 'ERROR: ' + e.message; }

    // 4.2: هل showScreen يمنع فتح لوحة المؤس؟
    try {
      if (typeof showScreen === 'function') showScreen('founderDashboardScreen');
      out.showScreenGuard = 'showScreen اتنفّذ';
    } catch (e) { out.showScreenGuard = 'ERROR: ' + e.message; }
    await new Promise(r => setTimeout(r, 1200));

    const fd = document.getElementById('founderDashboardScreen');
    out.founderVisibleAfterForge = fd ? getComputedStyle(fd).display !== 'none' : 'missing';

    // 4.3: الحل البديل — إزالة صنف hidden مباشرة (بدون showScreen)
    try {
      document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
      fd.classList.remove('hidden');
      fd.classList.add('active');
      out.directClassForge = 'اتفتحت بإزالة .hidden مباشرة';
    } catch (e) { out.directClassForge = 'ERROR: ' + e.message; }

    // 4.4: هل البيانات تُجلب فعلياً من قاعدة البيانات بعد الفتح؟
    out.rowsAfterForge = [...fd.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td')).length;
    out.statusCells = [...fd.querySelectorAll('tbody tr td')].map(td => td.textContent.trim()).filter(Boolean).slice(0, 12);

    // 4.5: تشغيل دوال المؤس مباشرة
    const fns = ['loadFounderStats', 'displayAllDeliveryPersons', 'loadPendingDeliveries', 'initFounderSettings', 'loadGlobalFounderVisibility'];
    out.founderDebugFns = {};
    for (const f of fns) {
      out.founderDebugFns[f] = typeof window[f];
      if (typeof window[f] === 'function') {
        try { await Promise.race([window[f](), new Promise(r => setTimeout(r, 4000))]); } catch (e) { /* ignore */ }
      }
    }
    // هل هناك أى بناء بيانات حقيقية (وليس نص "جاري التحميل")؟
    const cellTexts = [...fd.querySelectorAll('tbody td')].map(td => td.textContent.trim()).filter(Boolean);
    out.realDataCells = cellTexts.filter(t => t && t !== 'جاري التحميل...' && t !== 'لا توجد بيانات');
    out.placeholderCells = cellTexts.filter(t => t === 'جاري التحميل...');
    out.textSampleAfterFn = String(fd.innerText || '').split(/\s+/).join(' ').slice(0, 300);
    return out;
  `);
  const realData = (escalation.realDataCells || []).filter(t => t && t !== '0');
  record('PRIVESC', 'هل تستطيع الواجهة منع فتح لوحة المؤس؟ (متوقع: لا — الحماية مش هنا)',
    escalation.founderVisibleAfterForge === true ? WARN : PASS,
    `شاشة المؤس ظاهرة بعد المحاولة: ${escalation.founderVisibleAfterForge} — الحماية الصحيحة على مستوى قاعدة البيانات وليست الواجهة`);
  record('PRIVESC', 'الحماية الحقيقية: هل تسرّب الواجهة بيانات فعلية لحساب مزوّر؟',
    realData.length > 0 ? FAIL : PASS,
    `خلايا بها بيانات حقيقية: ${realData.length} ${realData.length ? '→ ' + JSON.stringify(realData.slice(0, 6)) : '(كل الخلايا البرنامجية "جاري التحميل..." أو صفر)'}\nplaceholder: ${JSON.stringify((escalation.placeholderCells || []).slice(0, 4))}\nنص: ${escalation.textSampleAfterFn}`);

  // ===== (4-ب) رفع صلاحية بتوكن مجهول حقي من Supabase =====
  console.log('\n===== (4-ب) رفع الصلاحية بتوكن anon حقي (عبر auth/v1) =====\n');
  const anonToken = await (async () => {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: '{}'
      });
      if (!r.ok) return { ok: false, status: r.status, body: (await r.text()).slice(0, 200) };
      const d = await r.json();
      return { ok: true, token: d.access_token, id: d.user?.id };
    } catch (e) { return { ok: false, body: e.message }; }
  })();
  if (!anonToken.ok) {
    record('PRIVESC-TOKEN', 'طلب توكن anon من Supabase (لتجربة رفع الصلاحية)', INFO,
      `مرفوض (${anonToken.status || '?'}): ${anonToken.body} → لا يمكن تزوير هوية بدون حساب، وهذا جيد`);
  } else {
    const h = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + anonToken.token, 'Content-Type': 'application/json' };
    const uid = anonToken.id;
    // هل يستطيع كتابة صف user_data لنفسه؟
    const ins = await fetch(SUPABASE_URL + '/rest/v1/user_data', {
      method: 'POST', headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ id: uid, name: 'attacker', email: 'x@x.com', account_type: 'founder', status: 'approved' })
    });
    const insBody = (await ins.text()).slice(0, 250);
    record('PRIVESC-TOKEN', 'هل يمكن إنشاء صف user_data بدور founder من المتصفح؟', ins.ok ? FAIL : PASS,
      `HTTP ${ins.status} | ${insBody}`);

    // هل يستطيع رفع دوره بعد الإنشاء؟
    const upd = await fetch(SUPABASE_URL + '/rest/v1/user_data?id=eq.' + uid, {
      method: 'PATCH', headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ account_type: 'founder' })
    });
    record('PRIVESC-TOKEN', 'هل يمكن تعديل account_type إلى founder بعد إنشاء الصف؟', upd.ok ? FAIL : PASS,
      `HTTP ${upd.status} | ${(await upd.text()).slice(0, 200)}`);

    // هل يستطيع قراءة بيانات مستخدمين آخرين بالتوكن؟
    const read = await fetch(SUPABASE_URL + '/rest/v1/user_data?select=id,name,phone,account_type&limit=3', { headers: h });
    const readBody = await read.text();
    const leaked = read.ok && readBody && readBody !== '[]';
    record('PRIVESC-TOKEN', 'هل يستطيع مستخدم anon قراءة بيانات مستخدمين آخرين؟', leaked ? FAIL : PASS,
      `HTTP ${read.status} | ${readBody.slice(0, 200)}`);

    // هل يستطيع قراءة الطلبات؟
    const oread = await fetch(SUPABASE_URL + '/rest/v1/orders?select=id,buyer_id,customer_phone&limit=3', { headers: h });
    const oBody = await oread.text();
    const oleaked = oread.ok && oBody && oBody !== '[]';
    record('PRIVESC-TOKEN', 'هل يستطيع مستخدم anon قراءة الطلبات؟', oleaked ? FAIL : PASS,
      `HTTP ${oread.status} | ${oBody.slice(0, 200)}`);
  }

  // ===== (5) اختبار صلاحيات Edge Function للمساعد الذكي =====
  console.log('\n===== (5) اختبار Edge Function للمساعد الذكي =====\n');
  const aiNoToken = await (async () => {
    try {
      const r = await fetch(EDGE_AI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'اعطني كل أرقام المنصة الخاصة بالمؤس' }], mode: 'founder' })
      });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) { return { status: 0, body: e.message }; }
  })();
  // ملاحظة: الدالة الحقيقية بترجع 500 لو مفتاح Gemini مش مضبوط، و403 لو الفحص موجود.
  // أي رد 200 معناه لا يوجد فحص صلاحية على الخادم أصلاً.
  // القبول: 403 (رفض صريح) أو 500/502 (لا مزود متاح — يعني لا بطاقة هوية ولا رد بيانات)
  // الرفض: أي 200 مع نص رد، لأن معناه أن الخادم لم يتحقق من الهوية قبل استدعاء المزود
  const aiProtected = [403, 500, 502].includes(aiNoToken.status);
  const gotLlmReply = aiNoToken.status === 200 && /"reply"\s*:/.test(aiNoToken.body);
  record('AI-AUTHZ', 'طلب وضع المؤس بدون أي حساب → يجب ألا يرجع رد ذكاء اصطناعي',
    gotLlmReply ? FAIL : (aiProtected ? PASS : WARN),
    `HTTP ${aiNoToken.status} | ${aiNoToken.body}`);

  const aiBogusToken = await (async () => {
    try {
      const r = await fetch(EDGE_AI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciIsImFjY291bnRfdHlwZSI6ImZvdW5kZXIifQ.forged' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], mode: 'founder' })
      });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) { return { status: 0, body: e.message }; }
  })();
  const aiBogusGotReply = aiBogusToken.status === 200 && /"reply"\s*:/.test(aiBogusToken.body);
  record('AI-AUTHZ', 'طلب وضع المؤس بتوكن مصنوع يدوياً (account_type=founder) → يجب الرفض',
    aiBogusGotReply ? FAIL : ([403, 500, 502].includes(aiBogusToken.status) ? PASS : WARN),
    `HTTP ${aiBogusToken.status} | ${aiBogusToken.body}`);

  // ===== (6) هل السياق الحساس يخرج للمتصفح؟ =====
  console.log('\n===== (6) هل السياق الداخلي للمؤس يُبنى في المتصفح؟ =====\n');
  // الفحص الحاسم: هل ينجح زائر بلا تسجيل في وضع founder في سياق المساعد؟
  const ctxLeak = await mainWorld(page, `
    const out = {};
    // نسجّل زائراً بلا أي حساب
    appState.user = null;
    appState.userData = { account_type: 'client' };
    try { if (typeof setMisarFounderMode === 'function') setMisarFounderMode(false); } catch (e) {}
    if (typeof buildMisarFounderContext !== 'function') { out.available = false; return out; }
    out.available = true;
    const c = await Promise.race([buildMisarFounderContext(), new Promise(r => setTimeout(() => r('__TIMEOUT__'), 8000))]);
    const txt = String(c || '');
    out.length = txt.length;
    out.sample = txt.slice(0, 400);
    // استخراج أرقام المنصة الحقيقية من نص السياق
    out.numbers = (txt.match(/:\s*\d+/g) || []).map(s => s.replace(/\D/g, ''));
    return out;
  `);
  const ctxLeakedNumbers = (ctxLeak.numbers || []).filter(n => n && n !== '0');
  record('DATA-EXPOSURE', 'هل يبني الزائر سياق المؤس الكامل ويحصل على أرقام المنصة؟',
    ctxLeakedNumbers.length > 0 ? FAIL : (ctxLeak.available ? PASS : INFO),
    ctxLeak.available
      ? `السياق متاح في المتصفح (${ctxLeak.length} حرف). أرقام غير صفرية استخرجها الزائر: ${JSON.stringify(ctxLeakedNumbers)}\nعيّنة: ${(ctxLeak.sample || '').split(/\s+/).join(' ').slice(0, 260)}`
      : 'الدالة غير متاحة');
  record('DATA-EXPOSURE', 'ملاحظة أمنية: بناء السياق يتم في المتصفح لا على الخادم',
    ctxLeak.available ? WARN : PASS,
    ctxLeak.available
      ? 'دوال buildMisarFounderContext/tryFounderReportAnswer موجودة في الواجهة — أمانها يعتمد كلياً على سياسات RLS في قاعدة البيانات'
      : 'غير موجودة');

  // ===== (7) أسرار داخل ملفات الواجهة =====
  console.log('\n===== (7) فحص تسريب الأسرار في ملفات الواجهة =====\n');
  const secretScan = await mainWorld(page, `
    const files = ['js/supabase.js', 'js/misar-ai.js', 'js/cart.js', 'js/products.js', 'sw.js'];
    const findings = [];
    const patterns = [
      { name: 'مفتاح OpenAI (sk-)', re: /sk-[A-Za-z0-9_\-]{20,}/g },
      { name: 'مفتاح Gemini (AQ.)', re: /AQ\.[A-Za-z0-9_\-]{20,}/g },
      { name: 'كلمة service_role', re: /service_role/gi },
      { name: 'توكن JWT كامل', re: /eyJhbGciOiJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]{20,}/g },
      { name: 'كلمة سر مكتوبة', re: /password\s*[:=]\s*['"][^'"]{4,}['"]/gi },
    ];
    for (const f of files) {
      try {
        const txt = await (await fetch('../' + f)).text();
        for (const p of patterns) {
          const m = txt.match(p.re);
          if (m) findings.push(f + ': ' + p.name + ' -> ' + m.slice(0, 3).join(', ').slice(0, 120));
        }
      } catch (e) { findings.push(f + ': تعذر القراءة'); }
    }
    return findings;
  `);
  record('SECRETS', 'ملفات الواجهة لا تحتوي مفاتيح سيرفر', secretScan.length === 0 ? PASS : FAIL,
    secretScan.length ? secretScan.join(' || ') : 'لا يوجد أي مفتاح مكشوف');

  // ===== (8) تمرير HTML من البيانات إلى الواجهة (XSS مخزّن) =====
  console.log('\n===== (8) حقن HTML/JS عبر بيانات المستخدم (XSS مخزّن) =====\n');
  // ملفات الواجهة تُقرأ من نظام الملفات مباشرة (لا حاجة للمتصفح)
  const srcFiles = ['js/supabase.js', 'js/cart.js', 'js/returns.js', 'js/products.js', 'js/product.js', 'js/banners.js', 'js/admin-locations.js', 'js/admin-banners.js'];
  const templates = { raw: 0, escaped: 0, lines: [] };
  for (const f of srcFiles) {
    try {
      const txt = readFileSync(join(process.cwd(), f), 'utf8');
      txt.split('\n').forEach((ln, i) => {
        if (/\.innerHTML\s*=\s*['"]/.test(ln) || /\.innerHTML\s*\+=/.test(ln)) {
          if (/\$\{[^}]*\}/.test(ln)) {
            if (/escapeHTML|escHTML|textContent|encodeURIComponent/.test(ln)) templates.escaped++;
            else { templates.raw++; templates.lines.push(`${f}:${i + 1} ${ln.trim().slice(0, 130)}`); }
          }
        }
      });
    } catch (e) { templates.lines.push(f + ': تعذر القراءة'); }
  }

  const xss = await mainWorld(page, `
    const payload = '<img src=x onerror="window.__XSS_FIRED=true">';
    window.__XSS_FIRED = false;
    const out = {};

    // 8.1: حقن في حقل الاسم ثم عرضه عبر escapeHTML (الطريقة الآمنة)
    const esc = window.escapeHTML || (typeof escapeHTML === 'function' ? escapeHTML : null);
    if (typeof esc === 'function') {
      const safeEl = document.createElement('div');
      safeEl.innerHTML = esc(payload);
      document.body.appendChild(safeEl);
      out.escapeHTMLSafe = safeEl.querySelector('img') === null && safeEl.textContent.includes('onerror');
      safeEl.remove();
    } else out.escapeHTMLSafe = 'escapeHTML غير موجودة';

    return out;
  `);
  record('XSS', 'دالة escapeHTML تعمل وتمنع تنفيذ HTML', xss.escapeHTMLSafe === true ? PASS : FAIL,
    'escapeHTML= ' + String(xss.escapeHTMLSafe));
  record('XSS', 'قوالب innerHTML بدون تعقيم (يُقارن مع المعقّمة)',
    templates.raw > 0 ? WARN : PASS,
    `غير معقّمة: ${templates.raw} | معقّمة: ${templates.escaped}\nأمثلة:\n` + templates.lines.slice(0, 8).join('\n'));

  // اختبار عملي: حقن بيانات في حقل حقي ثم إعادة رسمها
  const xssLive = await mainWorld(page, `
    window.__XSS_FIRED = false;
    const payload = '<img src=x onerror="window.__XSS_FIRED=true">';
    if (typeof appState !== 'undefined') {
      appState.userData = { ...(appState.userData || {}), name: payload, email: payload, phone: payload, center: payload };
      appState.user = { id: 'x', email: payload, user_metadata: { full_name: payload } };
    }
    try { if (typeof updateUserInfo === 'function') updateUserInfo(); } catch (e) { /* ignore */ }
    if (typeof loadPendingDeliveries === 'function') {
      appState.userData = { account_type: 'founder' };
      try { await Promise.race([loadPendingDeliveries(), new Promise(r => setTimeout(r, 3000))]); } catch (e) { /* ignore */ }
    }
      await new Promise(r => setTimeout(r, 700));
      return { fired: window.__XSS_FIRED === true, imgs: document.querySelectorAll('img[src="x"]').length };
    `);
  record('XSS', 'اختبار عملي: حقن اسم مستخدم ضار ثم إعادة رسم الواجهة',
    xssLive.fired ? FAIL : PASS,
    `نُفّذ السكربت: ${xssLive.fired} | صور محقونة في DOM: ${xssLive.imgs}`);

  // ===== (9) هل الأسرار الحساسة محفوظة في localStorage بدون تشفير؟ =====
  console.log('\n===== (9) فحص التخزين المحلي =====\n');
  const storage = await mainWorld(page, `
    const out = { local: {}, session: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      out.local[k] = v.length > 120 ? v.slice(0, 60) + '...(' + v.length + ' حرف)' : v;
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      out.session[k] = String(sessionStorage.getItem(k)).slice(0, 60);
    }
    return out;
  `);
  const storageKeys = Object.keys(storage.local || {});
  record('STORAGE', 'مفاتيح مخزنة محلياً', INFO, JSON.stringify(storageKeys));
  const tokenKeys = storageKeys.filter(k => /auth-token|access_token|refresh/i.test(k));
  record('STORAGE', 'توكن الجلسة مخزّن في localStorage (قابل للسرقة بـ XSS)',
    tokenKeys.length ? WARN : PASS,
    tokenKeys.length ? `مفاتيح: ${tokenKeys.join(', ')} — أي XSS يسرق الجلسة كاملة` : 'لا يوجد توكن مخزّن');

  // ===== (10) رؤوس الأمان / HTTPS / CSP =====
  console.log('\n===== (10) رؤوس الأمان (CSP / X-Frame-Options) =====\n');
  const headers = await (async () => {
    const r = await fetch(BASE, { method: 'GET' });
    const h = {};
    r.headers.forEach((v, k) => { h[k] = v; });
    return h;
  })();
  const hasCsp = Object.keys(headers).some(k => k.toLowerCase() === 'content-security-policy');
  const hasFrame = Object.keys(headers).some(k => /x-frame-options|frame-ancestors/i.test(k));
  record('HEADERS', 'سياسة CSP موجودة (تمنع XSS تسرق الجلسة)', hasCsp ? PASS : FAIL,
    hasCsp ? 'موجودة' : 'غير موجودة — لا يوجد أي حاجز ثانٍ لو صار XSS');
  record('HEADERS', 'حماية ضد Clickjacking (X-Frame-Options / frame-ancestors)', hasFrame ? PASS : FAIL,
    hasFrame ? 'موجودة' : 'غير موجودة — الموقع يمكن تضمينه في iframe داخل موقع مزيف');

  // ===== (11) تحليل ثابت: ثقة عمياء في حسابات العميل =====
  console.log('\n===== (11) تحليل كود: قرارات الأمان على طرف العميل =====\n');
  // نقرأ الملفات في Node مباشرة لكي لا تُستهلك الشرطة العكسية داخل قالب mainWorld
  const codeAudit = [];
  const auditFiles = ['js/supabase.js', 'js/misar-ai.js', 'js/admin-locations.js', 'js/admin-banners.js', 'js/admin-dashboard.js', 'js/online-users.js'];
  const CRED_RE = /sa3dgelany@gmail\.com/i;
  const WEAK_PW_RE = /password\s*!==\s*'123456'/;
  const ESCALATE_RE = /account_type\s*=\s*'founder'/;
  for (const f of auditFiles) {
    let txt = '';
    try { txt = readFileSync(join(process.cwd(), f), 'utf8'); } catch { continue; }
    txt.split('\n').forEach((ln, i) => {
      if (CRED_RE.test(ln)) codeAudit.push(`${f}:${i + 1} بريد المؤس مكتوب صراحة في الواجهة`);
      if (WEAK_PW_RE.test(ln)) codeAudit.push(`${f}:${i + 1} كلمة مرور المؤس '123456' مكتوبة في الواجهة`);
      if (ESCALATE_RE.test(ln)) codeAudit.push(`${f}:${i + 1} رفع الصلاحية إلى founder من المتصفح`);
    });
  }
  record('CODE-AUDIT', 'بيانات اعتماد المؤس مكتوبة داخل كود الواجهة',
    codeAudit.length === 0 ? PASS : FAIL,
    codeAudit.length ? codeAudit.slice(0, 10).join('\n') : 'نظيف — لا توجد بيانات اعتماد في الواجهة');

  // ===== (12) canAccessScreen و أي حمايات معطّلة =====
  console.log('\n===== (12) الدوال المكشوفة عالمياً على window =====\n');
  const globals = await mainWorld(page, `
    const names = ['showScreen', 'loadFounderStats', 'loadPendingDeliveries', 'displayAllDeliveryPersons',
      'approveDeliveryPerson', 'deleteFounderCenter', 'saveLocAdminSettings', 'initFounderSettings',
      'loadAllUsers', 'saveAppSetting', 'buildMisarFounderContext', 'getMisarAiResponse'];
    return names.map(n => ({ n, t: typeof window[n] }));
  `);
  const dangerous = (globals || []).filter(g => g.t === 'function');
  record('GLOBALS', 'دوال إدارية مكشوفة في المتصفح', dangerous.length > 6 ? WARN : INFO,
    dangerous.map(g => g.n).join(', ') || '(لا شيء)');
  record('GLOBALS', 'الحماية الفعلية لهذه الدوال تعتمد على RLS في قاعدة البيانات لا على الواجهة',
    INFO, 'أي أن أمانها = أمان سياسات RLS — راجع نتائج قسم REST-ANON أعلاه.');

  // ===== (13) أخطاء الكونسول =====
  console.log('\n===== (13) أخطاء التشغيل =====\n');
  const realErrors = consoleErrors.filter(e => !/Failed to load resource|favicon|font-awesome|cdn\.jsdelivr|ERR_/i.test(e));
  record('RUNTIME', 'لا أخطاء جافاسكربت أثناء التحميل', realErrors.length === 0 ? PASS : WARN,
    realErrors.length ? realErrors.slice(0, 6).join('\n') : 'نظيف');

  await browser.close();
  if (server) server.kill();

  // ---------- التقرير ----------
  const fails = results.filter(r => r.verdict === FAIL);
  const warns = results.filter(r => r.verdict === WARN);
  const md = [];
  md.push('# 🛡️ تقرير الاختراق الشامل — MISAR SYSTEMS');
  md.push('');
  md.push(`**التاريخ:** ${new Date().toISOString()}`);
  md.push(`**الهدف:** ${BASE}`);
  md.push(`**النتيجة:** ${results.length} اختبار — ❌ ${fails.length} فشل | ⚠️ ${warns.length} تحذير | ✅ ${results.filter(r => r.verdict === PASS).length} نجاح`);
  md.push('');
  md.push('## ملخص الثغرات المؤكدة والخطيرة');
  md.push('');
  if (fails.length === 0) md.push('لا توجد ثغرات مؤكدة ✅');
  fails.forEach((f, i) => {
    md.push(`### ${i + 1}. ${f.name}  \`${f.group}\``);
    md.push('');
    md.push('```');
    md.push(f.detail);
    md.push('```');
    md.push('');
  });
  md.push('## تحذيرات تحتاج مراجعة');
  md.push('');
  warns.forEach(w => {
    md.push('- **' + w.name + '** (' + w.group + '): ' + String(w.detail).split(/[\r\n]+/).join(' '));
  });
  md.push('');
  md.push('## كل النتائج');
  md.push('');
  md.push('| # | المجموعة | الاختبار | النتيجة | التفاصيل |');
  md.push('|---|---|---|');
  results.forEach((r, i) => {
    const v = r.verdict === 'PASS' ? '✅' : r.verdict === 'FAIL' ? '❌' : r.verdict === 'WARN' ? '⚠️' : 'ℹ️';
    md.push('| ' + (i + 1) + ' | ' + r.group + ' | ' + r.name + ' | ' + v + ' | ' + String(r.detail).split(/[\r\n]+/).join(' ').split('|').join('/').slice(0, 220) + ' |');

  });
  writeFileSync(OUT_LOG, md.join('\n'), 'utf8');

  console.log('\n\n================ الخلاصة ================');
  console.log(`إجمالي: ${results.length} | فشل: ${fails.length} | تحذير: ${warns.length} | نجاح: ${results.filter(r => r.verdict === 'PASS').length}`);
  console.log(`التقرير الكامل: ${OUT_LOG}`);
  if (fails.length) {
    console.log('\n❌ الثغرات المؤكدة:');
    fails.forEach(f => console.log(`  - [${f.group}] ${f.name}`));
  }
  if (warns.length) {
    console.log('\n⚠️ تحذيرات:');
    warns.forEach(w => console.log(`  - [${w.group}] ${w.name}`));
  }
})();
