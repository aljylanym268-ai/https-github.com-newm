// اختبار بقاء جلسة المستخدم بعد إعادة تحميل الصفحة (محاكاة إعادة نشر الموقع)
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function resolveChromium() {
  const base = join(homedir(), '.vscode/extensions')
  const dirs = readdirSync(base).filter(d => d.startsWith('danielsanmedium.dscodegpt-')).sort()
  const root = join(base, dirs[dirs.length - 1], 'standalone') + '/'
  const mod = createRequire(root)('patchright')
  return mod.chromium ?? mod.default.chromium
}

const chromium = resolveChromium()
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const ctx = await browser.newContext()
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('CONSOLE-ERR:', t.slice(0, 200)) })

const URL_BASE = 'http://localhost:8131/index.html'

await p.goto(URL_BASE, { waitUntil: 'load' })
await p.waitForTimeout(5000)

// تسجيل الدخول (حقن في MAIN world عبر script tag لأن الدوال معرّفة داخل السكربتات العادية)
async function mainWorld(expr, page = p) {
  const id = '__r' + Math.random().toString(36).slice(2)
  const code = `(async()=>{const el=document.getElementById('${id}');try{el.dataset.r=JSON.stringify(await (${expr}));}catch(e){el.dataset.r='ERR:'+e.message;}})()`
  await page.evaluate(([id, code]) => {
    const s = document.createElement('script')
    s.id = id
    s.textContent = code
    document.documentElement.appendChild(s)
  }, [id, code])
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(100)
    const v = await page.evaluate(id => { const el = document.getElementById(id); return el ? (el.dataset.r ?? null) : null }, id)
    if (v !== null) {
      await page.evaluate(id => document.getElementById(id)?.remove(), id)
      return v
    }
  }
  return 'TIMEOUT'
}
const mainWorldOn = mainWorld

console.log('login:', await mainWorld(`(async()=>{const e=document.getElementById('loginEmail');if(!e)return 'no-login-form';e.value='sa3dgelany@gmail.com';document.getElementById('loginPassword').value='123456789';const f=window.login||window.signInWithEmail||window.signIn;if(!f)return 'no-fn:'+[typeof window.login,typeof window.signInWithEmail,typeof window.signIn,typeof window.handleLogin,typeof window.doLogin].join('/');await f();const t=[...document.querySelectorAll('.toast,[class*=toast]')].map(x=>x.innerText).join('|').slice(0,200);const s=await window.supabaseClient.auth.getSession();return 'after-login toast:'+t+' session:'+(s?.data?.session?'YES':'NO')})()`))
await p.waitForTimeout(6000)
console.log('بعد الدخول:', await mainWorld(`appState && appState.user ? 'logged-in ' + (appState.userData?.account_type||'?') : (appState ? 'no-user' : 'no-appstate')`))

// مفاتيح الجلسة في localStorage
console.log('مفاتيح التخزين:', await mainWorld(`Object.keys(localStorage).filter(k=>/auth|sb-|supabase/i.test(k)).join(',')`))

// إعادة تحميل الصفحة (محاكاة زيارة بعد نشر تحديث)
await p.reload({ waitUntil: 'load' })
await p.waitForTimeout(8000)
console.log('بعد reload #1:', await mainWorld(`appState && appState.user ? 'STILL-LOGGED-IN ' + (appState.userData?.account_type||'?') : (appState ? 'LOGGED-OUT' : 'no-appstate')`))
console.log('toast:', await mainWorld(`[...document.querySelectorAll('.toast,[class*=toast]')].map(t=>t.innerText).join('|').slice(0,120)`))

// reload ثانية
await p.reload({ waitUntil: 'load' })
await p.waitForTimeout(8000)
console.log('بعد reload #2:', await mainWorld(`appState && appState.user ? 'STILL-LOGGED-IN' : (appState ? 'LOGGED-OUT' : 'no-appstate')`))

// اختبار تبويب ثانٍ (نفس الجلسة محفوظة في localStorage)
const p2 = await ctx.newPage()
async function mainWorld2(expr) {
  const id = '__r' + Math.random().toString(36).slice(2)
  const code = `(async()=>{const el=document.getElementById('${id}');try{el.dataset.r=JSON.stringify(await (${expr}));}catch(e){el.dataset.r='ERR:'+e.message;}})()`
  await p2.evaluate(([id, code]) => {
    const s = document.createElement('script')
    s.id = id
    s.textContent = code
    document.documentElement.appendChild(s)
  }, [id, code])
  for (let i = 0; i < 150; i++) {
    await p2.waitForTimeout(100)
    const v = await p2.evaluate(id => { const el = document.getElementById(id); return el ? (el.dataset.r ?? null) : null }, id)
    if (v !== null) { await p2.evaluate(id => document.getElementById(id)?.remove(), id); return v }
  }
  return 'TIMEOUT'
}
p2.on('response', r => { if (r.status() === 409) console.log('TAB2-409:', r.url().slice(0, 140)) })
p2.on('console', m => console.log('TAB2:', m.type(), m.text().slice(0, 220)))
await p2.goto(URL_BASE, { waitUntil: 'load' })
await p2.waitForTimeout(12000)
console.log('تبويب ثانٍ:', await mainWorld2(`window.appState?.user ? 'TAB2-LOGGED-IN ' + (appState.userData?.account_type||'?') : (window.appState ? 'TAB2-LOGGED-OUT' : 'no-appstate')`))
// تفاصيل محتوى الجلسة في التبويب الثاني
console.log('جلسة تبويب 2:', await p2.evaluate(async () => {
  const raw = localStorage.getItem('sb-wwojtkxwmgkrudtevbcb-auth-token');
  if (!raw) return 'NO-STORED-TOKEN';
  let stored = 'unparsed';
  try { const d = JSON.parse(raw); stored = 'user:' + (d.user?.email || 'none'); } catch (e) { stored = 'PARSE-ERR'; }
  const hasClient = typeof supabaseClient !== 'undefined';
  let sess = 'no-client';
  if (hasClient) { try { const s = await supabaseClient.auth.getSession(); sess = 'session:' + (s?.data?.session ? 'YES' : 'NULL') + (s?.error ? ' err:' + s.error.message : ''); } catch (e) { sess = 'throw:' + e.message; } }
  return stored + ' | client:' + (hasClient ? 'exists' : 'MISSING') + ' | ' + sess;
}))
await p2.close()

// ===== اختبار الخروج اليدوي: يجب أن يخرج فعلاً =====
console.log('خروج يدوي:', await mainWorld(`(async()=>{try{await logout(false);return 'logout-called';}catch(e){return 'err:'+e.message;}})()`))
await p.waitForTimeout(4000)
console.log('بعد خروج يدوي:', await mainWorld(`window.appState?.user ? 'STILL-LOGGED-IN (BAD)' : 'LOGGED-OUT (GOOD)'`))
console.log('مفتاح الجلسة بعد الخروج:', await mainWorld(`Object.keys(localStorage).filter(k=>/auth-token/.test(k)).length + ' keys'`))

await browser.close()
