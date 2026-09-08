export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn);
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    (0, eval)(await (await fetch('js/supabase.js')).text());
    // ?????? ?? ??????? ??????
    const tables = ['orders', 'user_data', 'products', 'returns'];
    const out = {};
    for (const t of tables) {
      const { data, error } = await supabaseClient.from(t).select('*').limit(2);
      out[t] = error ? ('FAIL: ' + error.message) : ('OK: ' + (data ? data.length : 0) + ' rows');
    }
    return out;
  });
  return r;
}
