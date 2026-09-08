export default async function run(page, ui) {
  const after = await page.evaluate(async () => {
    // ????? supabase.js ?? ?????? ??? ???? ????? ?????
    const errors = [];
    window.addEventListener('error', e => errors.push(e.message));
    const r = await fetch('js/supabase.js');
    const txt = await r.text();
    const s = document.createElement('script');
    s.textContent = txt;
    document.body.appendChild(s);
    return { errors, supaType: typeof supabaseClient, appStateType: typeof window.appState };
  });
  return after;
}
