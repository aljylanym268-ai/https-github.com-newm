export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    const errs = [];
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn);
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    for (const f of ['js/supabase.js','js/banners.js','js/products.js','js/product.js','js/cart.js','js/returns.js']) {
      try { (0, eval)(await (await fetch(f)).text()); } catch(e) { errs.push(f + ' ? ' + e.message); }
    }
    // ?????? ?????
    appState.user = { id: '00000000-0000-0000-0000-000000000000' };
    appState.userData = { account_type: 'delivery', center: '???' };
    let result = null, loadErr = null;
    try { result = await loadAvailableOrders(); } catch(e) { loadErr = e.message; }
    let cards = [];
    if (result && result.length) {
      result.slice(0, 2).forEach(o => {
        try { cards.push(createOrderCardForDelivery(o, true).innerText.replace(/\n+/g, ' | ').slice(0, 250)); } catch(e) { cards.push('CARD ERR: ' + e.message); }
      });
    }
    return { errs, loadErr, count: result ? result.length : 0, cards };
  });
  return r;
}
