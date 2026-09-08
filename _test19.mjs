export default async function run(page, ui) {
  // ??? listener ??????? ??? ?? ?????? ?????: ???? ?? ????? JS ???????
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE: ' + m.text().slice(0,200)); });
  await page.goto('about:blank');
  await page.goto('http://localhost:8124/index.html', {waitUntil: 'load'});
  await page.waitForTimeout(4000);
  return { logs: logs.slice(0, 25) };
}
