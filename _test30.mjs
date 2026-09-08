export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    // ????? supabase ???? ?? ???? eval ??? CDN
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn); // eval ?? global scope
    const supaType = typeof window.supabase;
    if (!window.supabase) return { supaType, note: 'CDN UMD not registering on window in this env' };
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    const sb = await (await fetch('js/supabase.js')).text();
    (0, eval)(sb);
    const cart = await (await fetch('js/cart.js')).text();
    (0, eval)(cart);
    const fakeOrder = {
      id: '0123456789abcdef', status: 'confirmed', quantity: 1, total_price: 100, delivery_fee: 10,
      center: '???', shipping_address: '???? ?????????',
      seller: { id: 's1', name: 'Mohammed Sa3d', phone: '01080562909', governorate: '???', center: '???', village: '', address: '?????????' },
      buyer: { id: 'b1', name: '????', phone: '01000000000', address: '???' },
      products: { name: '???? ??????', image_url: null }
    };
    const c1 = createOrderCardForDelivery(fakeOrder, true);
    const c2 = createOrderCardForDelivery(fakeOrder, false);
    return { availableText: c1.innerText, myText: c2.innerText };
  });
  return r;
}
