export default async function run(page) {
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 200)));
  page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message.slice(0, 300)));
  await page.goto('http://localhost:8123/index.html', { waitUntil: 'commit' });
  await page.waitForTimeout(8000);
  return consoleMsgs.slice(0, 40);
}
