export default async function run(page, ui) {
  // ???? ?? ???????? JS ???? ?? ??????? ???? ??? CORS ?? ?????
  const result = await page.evaluate(async () => {
    // ?????? supabase.js ????
    const r = await fetch('js/supabase.js');
    const txt = await r.text();
    try { new Function(txt)(); } catch(e) { return {supaErr: e.message, len: txt.length}; }
    // ?????? products.js
    const r2 = await fetch('js/products.js');
    const t2 = await r2.text();
    try { new Function(t2)(); } catch(e) { return {prodErr: e.message, len: t2.length}; }
    return { allOk: true };
  });
  return result;
}
