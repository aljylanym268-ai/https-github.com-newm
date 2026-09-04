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
p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('CONSOLE-ERR:', t.slice(0, 250)) })

// run code in the MAIN world by injecting a script tag; result is stored on the tag's dataset (DOM is shared), poll until ready
async function mainWorld(expr) {
  const id = '__r' + Math.random().toString(36).slice(2)
  const code = `(async()=>{const el=document.getElementById('${id}');try{el.dataset.r=JSON.stringify(await (${expr}));}catch(e){el.dataset.r='ERR:'+e.message;}})()`
  await p.evaluate(([id, code]) => {
    const s = document.createElement('script')
    s.id = id
    s.textContent = code
    document.documentElement.appendChild(s)
  }, [id, code])
  for (let i = 0; i < 150; i++) {
    await p.waitForTimeout(100)
    const v = await p.evaluate(id => { const el = document.getElementById(id); return el ? (el.dataset.r ?? null) : null }, id)
    if (v !== null) {
      await p.evaluate(id => document.getElementById(id)?.remove(), id)
      return v
    }
  }
  return 'TIMEOUT'
}

await p.goto('http://localhost:8123/index.html', { waitUntil: 'load' })
await p.waitForTimeout(5000)

console.log('location screen govs:', await mainWorld(`document.querySelectorAll('#governorateSelect option').length`))
console.log('location screen centers:', await mainWorld(`[...document.querySelectorAll('#centerSelect option')].map(o=>o.value).join(',')`))

// login as founder
await mainWorld(`(async()=>{document.getElementById('loginEmail').value='sa3dgelany@gmail.com';document.getElementById('loginPassword').value='123456';await login();return 'ok';})()`)
await p.waitForTimeout(7000)
console.log('login:', await mainWorld(`appState.user ? 'logged-in as ' + appState.userData.account_type : 'no-user'`))

// open locations tab
await mainWorld(`(async()=>{showScreen('founderDashboardScreen');switchFounderTab('locations');return 'ok';})()`)
await p.waitForTimeout(3000)
console.log('admin gov select:', await mainWorld(`[...document.querySelectorAll('#locAdminGovSelect option')].length + ' gov(s), centers rendered: ' + document.getElementById('locAdminCentersList').children.length`))

// delete center 'قفط' from قنا then save
console.log('delete center:', await mainWorld(`(async()=>{deleteLocAdminCenter('قفط',false);await saveLocAdminSettings();clearLocationSettingsCache();const after=await getAvailableCenters('قنا');return JSON.stringify({after, includesقفط: after.includes('قفط')});})()`))

// verify the deleted center disappeared from the public location screen
await mainWorld(`(async()=>{showScreen('locationScreen');await populateCenterSelect(document.getElementById('centerSelect'),'قنا');return 'ok';})()`)
await p.waitForTimeout(1000)
console.log('public centers after delete:', await mainWorld(`[...document.querySelectorAll('#centerSelect option')].map(o=>o.value).join(',')`))

// restore center
console.log('restore center:', await mainWorld(`(async()=>{deleteLocAdminCenter('قفط',true);await saveLocAdminSettings();clearLocationSettingsCache();const after=await getAvailableCenters('قنا');return JSON.stringify({includesقفط: after.includes('قفط')});})()`))

// add a new governorate + center
console.log('add gov:', await mainWorld(`(async()=>{document.getElementById('locAdminNewGov').value='الإسكندرية';addLocAdminGov();const govSel=document.getElementById('locAdminGovSelect');document.getElementById('locAdminNewCenter').value='برج العرب';addLocAdminCenter();await saveLocAdminSettings();clearLocationSettingsCache();const govs=await getAvailableGovernorates();const centers=await getAvailableCenters('الإسكندرية');return JSON.stringify({govHasAlex: govs.includes('الإسكندرية'), alexCenters: centers});})()`))

// delete a whole governorate (أسوان) and verify
console.log('delete gov أسوان:', await mainWorld(`(async()=>{_locAdminSettings.deletedGovernorates.push('أسوان');await saveLocAdminSettings();clearLocationSettingsCache();const govs=await getAvailableGovernorates();return JSON.stringify({hasAswan: govs.includes('أسوان'), total: govs.length});})()`))
// restore it
console.log('restore gov أسوان:', await mainWorld(`(async()=>{_locAdminSettings.deletedGovernorates=_locAdminSettings.deletedGovernorates.filter(g=>g!=='أسوان');await saveLocAdminSettings();clearLocationSettingsCache();const govs=await getAvailableGovernorates();return JSON.stringify({hasAswan: govs.includes('أسوان')});})()`))

// cleanup: remove الإسكندرية test data
console.log('cleanup test gov:', await mainWorld(`(async()=>{delete _locAdminSettings.extraCenters['الإسكندرية'];await saveLocAdminSettings();clearLocationSettingsCache();const govs=await getAvailableGovernorates();return JSON.stringify({hasAlex: govs.includes('الإسكندرية')});})()`))

await p.screenshot({ path: '_qa_locations_tab.png' })
await browser.close()
console.log('DONE')
