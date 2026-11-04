const { chromium } = require('C:/Users/FUJITSU/.vscode-insiders/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright');
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: 'C:/Users/FUJITSU/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const perrs = [];
  p.on('pageerror', e => perrs.push(String(e).slice(0, 600)));
  await p.goto('http://localhost:8899/index.html', { waitUntil: 'domcontentloaded' }).catch(() => { });
  const r = await p.evaluate(() => new Promise(resolve => {
    const log = [];
    const s = document.createElement('script');
    s.src = '/vendor/supabase.js';
    s.onload = () => log.push('onload typeof=' + typeof window.supabase);
    s.onerror = () => log.push('onerror');
    document.head.appendChild(s);
    setTimeout(() => { log.push('final typeof=' + typeof window.supabase); resolve(log); }, 2000);
  }));
  console.log('LOG:', JSON.stringify(r));
  console.log('pageerrs:', perrs.join('|') || 'none');
  await b.close();
})();
