export default async function run(page, ui) {
  await page.waitForTimeout(4000); // ????? ??????? ????
  const result = await page.evaluate(() => ({
    cartLoaded: typeof window.createOrderCardForDelivery,
    supabaseClient: typeof supabaseClient,
    appState: typeof appState,
  }));
  return result;
}
