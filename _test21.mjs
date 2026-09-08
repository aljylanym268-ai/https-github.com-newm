export default async function run(page, ui) {
  // ???? ???? ???? supabase.js ????? runtime error ????? ??????? ?? syntax. ?????? ?? script tag ?????
  const r = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/supabase.js?x=' + Date.now();
      s.onload = () => resolve({ loaded: true, supa: typeof window.supabase });
      s.onerror = (e) => resolve({ loaded: false, err: 'script onerror' });
      document.head.appendChild(s);
    });
  });
  return r;
}
