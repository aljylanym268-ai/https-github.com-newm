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
const p = await browser.newPage()
p.on('pageerror', e => console.log('PAGEERROR:', e.message))
p.on('console', m => {
  const t = m.text()
  if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('CONSOLE-ERR:', t.slice(0, 250))
})

await p.goto('http://localhost:8123/index.html', { waitUntil: 'load' })
await p.waitForTimeout(5000)

console.log('gov options:', await p.evaluate(() => document.querySelectorAll('#governorateSelect option').length))
console.log('center options:', await p.evaluate(() => document.querySelectorAll('#centerSelect option').length))

await p.evaluate(() => { try { showScreen('loginScreen'); } catch (e) { const el = document.getElementById('loginScreen'); document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); if (el) el.classList.add('active'); } })
await p.waitForTimeout(500)
await p.evaluate(() => { document.getElementById('loginEmail').value = 'sa3dgelany@gmail.com'; document.getElementById('loginPassword').value = '123456'; })
await p.evaluate(() => { try { login(); } catch (e) { document.getElementById('loginBtn').click(); } })
await p.waitForTimeout(6000)

console.log('accountType:', await p.evaluate(() => window.appState && appState.userData ? appState.userData.account_type : 'no-appstate'))
console.log('welcome text:', await p.evaluate(() => document.getElementById('welcomeName')?.textContent))
console.log('login toast:', await p.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"], .alert')].map(t => t.textContent).slice(-3)))
await p.screenshot({ path: '_qa_after_login.png', fullPage: false })

await p.evaluate(() => { try { showScreen('founderDashboardScreen'); switchFounderTab('locations'); } catch (e) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById('founderDashboardScreen').classList.add('active'); document.querySelectorAll('.founder-tab-panel').forEach(x => x.classList.remove('active')); document.getElementById('tab-locations').classList.add('active'); if (typeof initFounderLocationsAdmin === 'function') initFounderLocationsAdmin(); } })
await p.waitForTimeout(3000)

console.log('locations tab exists:', await p.evaluate(() => !!document.getElementById('tab-locations')))
console.log('gov select in tab:', await p.evaluate(() => { const s = document.getElementById('locAdminGovSelect'); return s ? s.options.length : 'missing' }))
console.log('centers rendered:', await p.evaluate(() => { const l = document.getElementById('locAdminCentersList'); return l ? l.children.length : 'missing' }))

const toggleResult = await p.evaluate(async () => {
  const fn = typeof getAvailableCenters === 'function' ? getAvailableCenters : null;
  const govSel = document.getElementById('locAdminGovSelect');
  if (!fn) return { error: 'functions not visible from isolated world' };
  const before = await getAvailableCenters(govSel.value);
  toggleLocAdminCenter(before[0]);
  await saveLocAdminSettings();
  clearLocationSettingsCache();
  const after = await getAvailableCenters(govSel.value);
  return { gov: govSel.value, beforeCount: before.length, afterCount: after.length, removed: before[0] };
});
console.log('toggle+save:', JSON.stringify(toggleResult))

await browser.close()
