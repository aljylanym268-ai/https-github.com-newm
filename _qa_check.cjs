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
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));
  await page.addInitScript(stubSource());
  await page.route('**/supabase-js@**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('http://localhost:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1600);

  await page.evaluate(() => { document.getElementById('founderProfileScreen').classList.add('active'); });

  // 1) Click the IMAGE -> should open the image modal
  await page.locator('.founder-avatar').click();
  await page.waitForTimeout(300);
  const imgModal = await page.evaluate(() => {
    const m = document.getElementById('founderImageModal');
    const im = document.getElementById('founderModalImage');
    return { active: m ? m.classList.contains('active') : null, display: m ? getComputedStyle(m).display : null, src: im ? im.src.slice(-30) : null };
  });
  await page.screenshot({ path: '_qa_imgmodal.png' });

  // Close image modal
  await page.locator('#founderImageModal .close-modal').click();
  await page.waitForTimeout(200);
  const imgClosed = await page.evaluate(() => document.getElementById('founderImageModal').classList.contains('active'));

  // 2) Click the NAME -> should open the profile, NOT the image modal
  await page.locator('.founder-name').click();
  await page.waitForTimeout(300);
  const afterName = await page.evaluate(() => ({
    bio: document.getElementById('founderBioScreen').classList.contains('active'),
    imgModal: document.getElementById('founderImageModal').classList.contains('active'),
  }));

  await browser.close();
  console.log(JSON.stringify({ imgModal, imgClosed, afterName, logs }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
