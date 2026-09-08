export default async function run(page, ui) {
  // ??? CDN ????? 200. ?? window.supabase ?? ?????. ???? ??? ?? ?? UMD ?? CSP. ???? ???? CDN ????
  const r = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js';
      s.onload = () => resolve({ ok: true, supa: typeof window.supabase });
      s.onerror = () => resolve({ ok: false });
      document.head.appendChild(s);
    });
  });
  return r;
}
