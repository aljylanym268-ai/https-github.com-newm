export default async function run(page, ui) {
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' - ' + (r.failure()?.errorText || '')));
  await page.goto('http://localhost:8124/index.html', {waitUntil: 'load'});
  await page.waitForTimeout(5000);
  return { errors: errors.slice(0, 30) };
}
