export default async function run(page, ui) {
  const r = await page.evaluate(async () => {
    const cdn = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
    (0, eval)(cdn);
    window.initFounderLocationsAdmin = window.initFounderLocationsAdmin || function(){};
    (0, eval)(await (await fetch('js/supabase.js')).text());
    const { data: users, error: uErr } = await supabaseClient.from('user_data').select('id, name').limit(50);
    const { data: orders, error: oErr } = await supabaseClient.from('orders').select('id, status, center').limit(50);
    const { data: session } = await supabaseClient.auth.getSession();
    return { usersCount: users ? users.length : null, uErr, ordersCount: orders ? orders.length : null, oErr, session: session.session ? 'logged-in' : 'anon' };
  });
  return r;
}
