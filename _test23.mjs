export default async function run(page, ui) {
  // ????? ????? ?????? CDN ????: ?? ????? ??????
  const events = [];
  page.on('request', r => { if (r.url().includes('jsdelivr')) events.push('REQ: ' + r.url().slice(0, 100)); });
  page.on('response', r => { if (r.url().includes('jsdelivr')) events.push('RESP: ' + r.status() + ' ' + r.url().slice(0, 100)); });
  await page.goto('about:blank');
  await page.goto('http://localhost:8124/index.html', {waitUntil: 'load'});
  await page.waitForTimeout(3000);
  const supa = await page.evaluate(() => typeof window.supabase);
  return { events, supa };
}
