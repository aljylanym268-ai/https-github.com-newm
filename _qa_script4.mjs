export default async function run(page) {
  await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const results = [];
    return {
      hasLogin: !!document.getElementById('loginEmail'),
      screens: [...document.querySelectorAll('.screen')].map(s => s.id).slice(0, 25),
      test: (() => { try { return typeof showScreen; } catch (e) { return 'throw: ' + e.message; } })(),
      appStateType: (() => { try { return typeof appState; } catch (e) { return 'throw: ' + e.message; } })()
    };
  });
}
