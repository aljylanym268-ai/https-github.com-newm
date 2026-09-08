export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    // ????? ????? ?????????? ?? ??? ??????
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn);
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    (0, eval)(await (await fetch('js/supabase.js')).text());
    // ??????? ?????
    const { data: allOrders, error } = await supabaseClient
      .from('orders')
      .select('id, status, delivery_id, center, seller_id')
      .order('created_at', { ascending: false })
      .limit(10);
    return { allOrders, error };
  });
  return r;
}
