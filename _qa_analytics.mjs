export default async function run(page, ui) {
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}`));
  page.on('requestfailed', r => logs.push(`[REQFAIL] ${r.url().slice(0,100)} ${r.failure()?.errorText}`));
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // انتظر تحميل مكتبة supabase (قد تكون بطيئة)
  let supabaseReady = false;
  for (let i = 0; i < 90; i++) {
    supabaseReady = await page.evaluate(() => typeof window.supabase !== 'undefined' && typeof window.appState !== 'undefined');
    if (supabaseReady) break;
    await page.waitForTimeout(1000);
  }
  const res = await page.evaluate(() => ({
    supabase: typeof window.supabase,
    chart: typeof window.Chart,
    appState: typeof window.appState,
    showScreen: typeof window.showScreen,
    activeScreen: document.querySelector('.screen.active')?.id || null
  }));
  return { supabaseReady, res, logs: logs.filter(l => !l.startsWith('[verbose]')) };
}
