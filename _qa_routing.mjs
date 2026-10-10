export default async function run(page, ui) {
  // نتحقق من وجود طبقة التوجيه وعدم تأثر المؤسس
  const res = await page.evaluate(() => {
    const out = {};
    out.routeIdsCount = typeof MISAR_GM_ROUTE_IDS !== 'undefined' ? MISAR_GM_ROUTE_IDS.length : -1;
    out.hasApply = typeof misarApplyGmIdRouting === 'function';
    out.hasEl = typeof misarViewEl === 'function';
    out.hasGmReturns = typeof misarDisplayGmReturns === 'function';
    out.hasGmBanners = typeof misarRefreshGmBanners === 'function';
    out.hasGmFilters = ['misarGmFilterProducts', 'misarGmFilterOrders', 'misarGmFilterCustomers',
      'misarGmFilterSellers', 'misarGmFilterDeliveries', 'misarGmFilterServices',
      'misarGmFilterProductsByStatus'].every(f => typeof window[f] === 'function');

    // قبل تفعيل اللوحة: getElementById يجب أن يرجع عنصر المؤسس
    out.beforeGmContext = misarIsGmContext();
    out.beforeRoutedTo = document.getElementById('productsTableBody')?.id;

    // نفعّل سياق GM يدويًا
    const gmScreen = document.getElementById('generalManagerDashboardScreen');
    gmScreen.classList.add('active');
    document.getElementById('gm-tab-products').classList.add('active');

    out.afterGmContext = misarIsGmContext();
    // بعد الترقيع، يجب أن يُعاد توجيه productsTableBody إلى gm-productsTableBody
    misarApplyGmIdRouting();
    out.afterRoutedTo = document.getElementById('productsTableBody')?.id;
    out.gmDirect = document.getElementById('gm-productsTableBody')?.id;

    // تنظيف
    gmScreen.classList.remove('active');
    document.getElementById('gm-tab-products').classList.remove('active');
    return out;
  });
  return res;
}
