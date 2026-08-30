export default async function run(page, ui) {
  const reqs = [];
  page.on('response', r => {
    if (r.url().includes('supabase-js')) reqs.push({ u: r.url().slice(0, 80), s: r.status(), sw: r.fromServiceWorker() });
  });

  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  return { reqs, supabase: typeof window.supabase };
}