export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    const out = {};
    try { const resp = await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js'); out.cdnFetch = resp.status; } catch(e) { out.cdnFetch = 'FAIL: ' + e.message; }
    out.supaGlobal = typeof window.supabase;
    return out;
  });
  return r;
}
