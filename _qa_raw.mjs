import { createRequire } from 'node:module'
import { readdirSync, existsSync } from 'node:fs'
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
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) console.log('CONSOLE:', m.text().slice(0, 200)) })
await p.goto('http://localhost:8123/index.html', { waitUntil: 'load' })
await p.waitForTimeout(6000)
console.log('supabase:', await p.evaluate(() => typeof window.supabase))
console.log('client:', await p.evaluate(() => typeof window.supabaseClient))
console.log('populate:', await p.evaluate(() => typeof populateGovernorateSelect))
console.log('govs:', await p.evaluate(() => document.querySelectorAll('#governorateSelect option').length))
await browser.close()
