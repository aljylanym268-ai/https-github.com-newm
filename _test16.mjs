export default async function run(page, ui) {
  // supabase CDN ?? ?????! ?? ????? ?? ??? CDN scripts ????. ????? ??? ???????
  const errors = [];
  page.on('requestfailed', r => { if (r.url().includes('cdn')) errors.push(r.url() + ' | ' + (r.failure()?.errorText || '')); });
  page.on('response', r => { if (r.url().includes('cdn') && !r.ok()) errors.push(r.url() + ' | HTTP ' + r.status()); });
  await page.goto('http://localhost:8124/index.html', {waitUntil: 'load'});
  await page.waitForTimeout(3000);
  const loaded = await page.evaluate(() => [...document.scripts].filter(s=>s.src.includes('cdn')).map(s => ({src: s.src, ok: true})));
  return { errors, loadedCount: loaded.length };
}
