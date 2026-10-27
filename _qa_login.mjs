export default async function run(page, ui) {
  await page.waitForSelector('#loginScreen', { timeout: 20000 });
  await page.waitForTimeout(2000);
  const email = page.locator('#loginEmail');
  const pass = page.locator('#loginPassword');
  if ((await email.count()) === 0) return { error: 'no login form' };
  await email.fill('sa3dgelany@gmail.com');
  await pass.fill('123456789');
  const btn = page.locator('#loginBtn, button:has-text("تسجيل الدخول")').first();
  await btn.click();
  await page.waitForTimeout(6000);
  const active = await page.evaluate(() =>
    [...document.querySelectorAll('.screen')].filter(s => !s.classList.contains('hidden')).map(s => s.id)
  );
  return { activeScreens: active };
}
