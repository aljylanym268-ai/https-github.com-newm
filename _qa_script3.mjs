export default async function run(page) {
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 200)));
  page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message.slice(0, 300)));
  await page.addInitScript(() => {
    // stub the supabase CDN so inline scripts can run even offline-ish
    window.__cdnBlocked = false;
  });
  await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    supa: typeof window.supabase,
    client: typeof window.supabaseClient,
    appState: typeof window.appState,
    sw: typeof window.switchFounderTab,
    loadingOverlay: document.getElementById('loadingOverlay') ? getComputedStyle(document.getElementById('loadingOverlay')).display : 'none'
  }));
  return { state, msgs: consoleMsgs.filter(m => !m.startsWith('error: Failed')).slice(0, 20) };
}
