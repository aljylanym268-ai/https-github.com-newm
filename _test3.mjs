export default async function run(page, ui) {
  const result = await page.evaluate(() => ({
    cartLoaded: typeof window.createOrderCardForDelivery,
    productsLoaded: typeof window.addToCart,
    supaLoaded: typeof window.syncCartFromDB,
    cartScripts: [...document.scripts].map(s => s.src.split('/').pop()).filter(s => s.includes('cart'))
  }));
  return result;
}
