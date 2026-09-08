export default async function run(page, ui) {
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => ({
    cartLoaded: typeof window.createOrderCardForDelivery,
    appState: typeof appState,
    errors: window.__lastError || null
  }));
  // ??? ?? ??? JS ???
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.reload();
  await page.waitForTimeout(3000);
  return { result, errs };
}
