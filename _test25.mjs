export default async function run(page, ui) {
  // ???? listener ??????? ??? ??????? + ???? ?? UMD ????? error ????? ???????
  const r = await page.evaluate(async () => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(e.message));
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = () => setTimeout(() => resolve({ supa: typeof window.supabase, errs: window.__errs }), 800);
      s.onerror = () => resolve({ err: 'load fail', errs: window.__errs });
      document.head.appendChild(s);
    });
  });
  return r;
}
