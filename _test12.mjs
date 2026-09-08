export default async function run(page, ui) {
  // ???? ??? 200 ??? ?? supabase.js ???? 500 ??? ???? ???? ????? supabaseClient
  const r = await page.evaluate(async () => {
    const txt = await (await fetch('js/supabase.js')).text();
    const idx = txt.indexOf('supabaseClient');
    return { first: txt.slice(0, 300), aroundClient: txt.slice(Math.max(0,idx-100), idx+200) };
  });
  return r;
}
