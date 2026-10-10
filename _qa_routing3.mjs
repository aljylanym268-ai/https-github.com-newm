export default async function run(page, ui) {
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const r = {};
    // الدوال المُصدَّرة إلى window (متاحة في العالم الرئيسي)
    r.windowExports = ['misarIsFounder', 'misarIsGeneralManager', 'misarGmCan', 'misarLoadGmSettings',
      'misarLoadGmList', 'misarInitGeneralManagerDashboard', 'misarRenderGmAdminPanel',
      'misarRenderGmStats', 'misarDisplayGmReturns', 'misarRefreshGmBanners',
      'misarIsGmContext', 'misarViewEl', 'misarApplyGmIdRouting']
      .reduce((a, f) => (a[f] = typeof window[f] === 'function', a), {});
    r.gmFiltersExported = ['misarGmFilterProducts', 'misarGmFilterOrders', 'misarGmFilterCustomers',
      'misarGmFilterSellers', 'misarGmFilterDeliveries', 'misarGmFilterServices',
      'misarGmFilterProductsByStatus']
      .reduce((a, f) => (a[f] = typeof window[f] === 'function', a), {});
    // قبل سياق GM
    r.beforeRoutedTo = document.getElementById('productsTableBody')?.id;
    return r;
  });

  // نفّذ السيناريو من العالم الرئيسي عبر addScriptTag
  await page.addScriptTag({
    content: `
    window.__qaScenario = (function(){
      const out = {};
      try {
        const gmScreen = document.getElementById('generalManagerDashboardScreen');
        gmScreen.classList.add('active');
        document.getElementById('gm-tab-products').classList.add('active');
        window.misarApplyGmIdRouting();
        out.afterRoutedTo = document.getElementById('productsTableBody')?.id;
        gmScreen.classList.remove('active');
        document.getElementById('gm-tab-products').classList.remove('active');
        out.restoredTo = document.getElementById('productsTableBody')?.id;
      } catch(e) { out.error = String(e); }
      return out;
    })();
  ` });
  const scenario = await page.evaluate(() => window.__qaScenario);
  return { ...out, scenario };
}
