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
p.on('console', m => {
  const t = m.text()
  if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('CONSOLE-ERR:', t.slice(0, 250))
})

// Expose a bridge so page functions can be called from main world
await ctx.exposeBinding('__pageCall', async (source, code) => {
  return await p.evaluate(code)
})

await p.goto('http://localhost:8123/index.html', { waitUntil: 'load' })
await p.waitForTimeout(5000)

// Inject a recorder into the main world via a script tag (runs in main world)
await p.evaluate(() => {
  const s = document.createElement('script');
  s.textContent = `
    window.__results = {};
    window.__runMain = async (name, fn) => { try { window.__results[name] = await fn(); } catch(e) { window.__results[name] = 'ERR: ' + e.message; } };
  `;
  document.documentElement.appendChild(s);
})
console.log('main world test:', await p.evaluate(() => new Promise(res => {
  const s = document.createElement('script');
  s.textContent = "window.__mainCheck = typeof populateGovernorateSelect + '|' + typeof showScreen + '|' + (window.appState ? 'appstate-ok' : 'no-appstate');";
  document.documentElement.appendChild(s);
  setTimeout(() => res(window.__mainCheck), 300);
})))
console.log('direct check:', await p.evaluate(() => typeof showScreen))
console.log('raw B check:', await p.evaluate(() => typeof window.B))
await p.evaluate(() => new Promise(res => { const s = document.createElement('script'); s.textContent = 'window.B=42;'; document.documentElement.appendChild(s); setTimeout(res, 200); }))
console.log('after inject B:', await p.evaluate(() => typeof window.B))

// login in main world
await p.evaluate(() => new Promise(res => {
  const s = document.createElement('script');
  s.textContent = `
    (async () => {
      try {
        window.__loginResult = 'start';
        document.getElementById('loginEmail').value = 'sa3dgelany@gmail.com';
        document.getElementById('loginPassword').value = '123456';
        if (typeof login === 'function') { await login(); window.__loginResult = 'login-called'; }
        else window.__loginResult = 'no-login-fn';
      } catch(e) { window.__loginResult = 'ERR: ' + e.message; }
    })();
  `;
  document.documentElement.appendChild(s);
  setTimeout(res, 500);
}))
await p.waitForTimeout(7000)

console.log('login result:', await p.evaluate(() => new Promise(res => {
  const s = document.createElement('script');
  s.textContent = "window.__loginState = (window.appState ? (appState.user ? 'logged-in:' + appState.userData.account_type : 'no-user') : 'no-appstate');";
  document.documentElement.appendChild(s);
  setTimeout(() => res(window.__loginState), 300);
})))

// open founder dashboard + locations tab in main world
await p.evaluate(() => new Promise(res => {
  const s = document.createElement('script');
  s.textContent = `
    (async () => {
      try {
        showScreen('founderDashboardScreen');
        switchFounderTab('locations');
        window.__tabState = 'ok';
      } catch(e) { window.__tabState = 'ERR: ' + e.message; }
    })();
  `;
  document.documentElement.appendChild(s);
  setTimeout(res, 3000);
}))
console.log('tab state:', await p.evaluate(() => window.__tabState))
console.log('gov select in tab:', await p.evaluate(() => { const s = document.getElementById('locAdminGovSelect'); return s ? s.options.length : 'missing' }))
console.log('centers rendered:', await p.evaluate(() => { const l = document.getElementById('locAdminCentersList'); return l ? l.children.length : 'missing' }))

// toggle first center + save, in main world
await p.evaluate(() => new Promise(res => {
  const s = document.createElement('script');
  s.textContent = `
    (async () => {
      try {
        const govSel = document.getElementById('locAdminGovSelect');
        const before = await getAvailableCenters(govSel.value);
        toggleLocAdminCenter(before[0]);
        await saveLocAdminSettings();
        clearLocationSettingsCache();
        const after = await getAvailableCenters(govSel.value);
        window.__toggleResult = JSON.stringify({ gov: govSel.value, before: before.length, after: after.length, removed: before[0] });
      } catch(e) { window.__toggleResult = 'ERR: ' + e.message; }
    })();
  `;
  document.documentElement.appendChild(s);
  setTimeout(res, 5000);
}))
console.log('toggle+save:', await p.evaluate(() => window.__toggleResult))

await browser.close()
