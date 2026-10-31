export default async function run(page, ui) {
  await page.waitForTimeout(5000);
  // شغّل الكود في السياق الرئيسي للصفحة (main world) عبر سكربت مُحقن
  await page.addScriptTag({
    content: `
    try {
      appState.userData = { account_type: 'seller', status: 'approved' };
      appState.user = appState.user || { id: 'test-user' };
      showScreen('sellerDashboardScreen');
      setTimeout(() => { try { switchSellerTab('analytics'); } catch(e) {} }, 800);
    } catch (e) {
      document.title = 'ERR: ' + e.message;
    }
  ` });
  await page.waitForTimeout(4000);
  return 'done';
}
