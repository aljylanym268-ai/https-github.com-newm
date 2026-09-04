export default async function run(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('script[src="js/supabase.js"]');
    // check function presence via a fresh inline injection
    const probe = document.createElement('script');
    probe.textContent = 'window.__probe = { pop: typeof populateGovernorateSelect, init: typeof initFounderLocationsAdmin, sw: typeof switchFounderTab, supa: typeof supabaseClient, app: typeof appState };';
    document.head.appendChild(probe);
    return { probe: JSON.parse(JSON.stringify(window.__probe || 'null')), scriptCount: document.querySelectorAll('script').length };
  });
}
