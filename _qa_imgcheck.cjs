const { chromium } = require('patchright');

function stubSource() {
  return `window.supabase = { createClient: function () {
    function chain(data) {
      var c = { select: function(){return c;}, eq: function(){return c;}, neq: function(){return c;}, order: function(){return c;}, limit: function(){return c;},
        single: async function(){return {data:data,error:null};}, maybeSingle: async function(){return {data:data,error:null};},
        then: function(r){return Promise.resolve({data:data,error:null}).then(r);},
        insert: async function(){return {error:null};}, update: function(){return c;}, upsert: async function(){return {error:null};}, delete: function(){return c;} };
      return c;
    }
    return {
      auth: { getSession: async function(){return {data:{session:null}};},
        onAuthStateChange: function(){ var s={unsubscribe:function(){}}; return {data:{subscription:s}}; },
        getUser: async function(){return {data:{user:null}};}, signOut: async function(){return {error:null};} },
      from: function(){ return chain([]); },
      storage: { from: function(){ return { upload: async function(){return {data:{},error:null};}, getPublicUrl: function(){return {data:{publicUrl:''}};} }; } },
      channel: function(){ return { on: function(){ return { subscribe: function(){ return {}; } }; } }; },
      removeChannel: function(){}
    };
  } };`;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const imgReq = [];
  page.on('response', r => { if (r.url().includes('ibb.co')) imgReq.push(r.status()); });
  page.on('requestfailed', r => { if (r.url().includes('ibb.co')) imgReq.push('FAILED: ' + (r.failure() ? r.failure().errorText : '?')); });
  await page.addInitScript(stubSource());
  await page.route('**/supabase-js@**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('http://localhost:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => {
    const avatarImg = document.querySelector('.founder-avatar img');
    return { avatarComplete: avatarImg ? avatarImg.complete : null, avatarNaturalW: avatarImg ? avatarImg.naturalWidth : null, avatarSrc: avatarImg ? avatarImg.src : null };
  });

  await page.evaluate(() => { document.getElementById('founderProfileScreen').classList.add('active'); });
  await page.locator('.founder-avatar').click();
  await page.waitForTimeout(500);

  const modalState = await page.evaluate(() => {
    const im = document.getElementById('founderModalImage');
    return { src: im.src, complete: im.complete, naturalWidth: im.naturalWidth };
  });

  await page.screenshot({ path: '_qa_imgmodal2.png' });
  await browser.close();
  console.log(JSON.stringify({ imgReq, state, modalState }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
