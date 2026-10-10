export default async function run(page, ui) {
  // انتظر انتهاء تحميل التطبيق
  await page.waitForTimeout(2500);

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
    out.hasWindowIsGmContext = typeof window.misarIsGmContext === 'function';

    // قبل أي تفعيل: document.getElementById يجب أن يرجع عنصر المؤسس (سلوك المؤسس سليم)
    out.beforeRoutedTo = document.getElementById('productsTableBody')?.id;

    // نفعّل سياق GM يدويًا (كما يحدث عند فتح لوحة المدير العام)
    const gmScreen = document.getElementById('generalManagerDashboardScreen');
    gmScreen.classList.add('active');
    document.getElementById('gm-tab-products').classList.add('active');

    misarApplyGmIdRouting();
    // الآن يجب أن يُعاد توجيه productsTableBody إلى gm-productsTableBody بإعادة قراءة المستند
    out.afterRoutedTo = document.getElementById('productsTableBody')?.id;

    // تنظيف
    gmScreen.classList.remove('active');
    document.getElementById('gm-tab-products').classList.remove('active');
    // بعد إزالة سياق GM يجب أن يعود العنصر للمؤسس
    out.restoredTo = document.getElementById('productsTableBody')?.id;
    return out;
  });
  return res;
}
