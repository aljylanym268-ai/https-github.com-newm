export default async function run(page, ui) {
  // ??? ????: ?? supabase CDN ?????? ? ?? supabase object ????? global?
  const r = await page.evaluate(() => {
    return {
      supabaseGlobal: typeof supabase,
      hasCreateClient: supabase ? typeof supabase.createClient : 'n/a',
      cdnScripts: [...document.scripts].filter(s => s.src.includes('cdn')).map(s => s.src.split('/').slice(3).join('/'))
    };
  });
  return r;
}
