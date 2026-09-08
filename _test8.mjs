export default async function run(page, ui) {
  // ???? ?? ?????? ?? ?????? ????? ?? ????? ?????
  const result = await page.evaluate(() => {
    return [...document.scripts].map(s => ({src: s.src.split('/').pop() || 'inline', loaded: !s.src || s.readyState === 'complete' || true}));
  }).then(async (scripts) => {
    // ???? ?????? createOrderCardForDelivery ??????
    let fn = 'undefined';
    try { fn = typeof createOrderCardForDelivery; } catch(e) { fn = 'err: ' + e.message; }
    return { scriptsCount: scripts.length, fn };
  });
  return result;
}
