export default async function run(page, ui) {
  // ???? ?? ?????????? ???????? ?????? ????? ?? ??? ??? runtime ?? cart.js ??????
  const logs = [];
  page.on('pageerror', e => logs.push('ERR: ' + e.message));
  const r = await page.evaluate(async () => {
    const errs = [];
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn);
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    const order = ['js/supabase.js','js/online-users.js','js/misar-ai.js','js/admin-dashboard.js','js/admin-banners.js','js/admin-locations.js','js/banners.js','js/products.js','js/product.js','js/cart.js','js/returns.js'];
    for (const f of order) {
      try {
        const txt = await (await fetch(f)).text();
        (0, eval)(txt);
      } catch(e) { errs.push(f + ' ? ' + e.message); }
    }
    return {
      errs,
      cartFn: typeof createOrderCardForDelivery,
      loadAvail: typeof loadAvailableOrders,
      appStateOk: typeof appState
    };
  });
  return { r, logs: logs.slice(0, 10) };
}
