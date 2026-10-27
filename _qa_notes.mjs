export default async function run(page, ui) {
  // 1) دخول
  await page.waitForSelector('#loginScreen', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.locator('#loginEmail').fill('sa3dgelany@gmail.com');
  await page.locator('#loginPassword').fill('123456789');
  await page.locator('#loginBtn, button:has-text("تسجيل الدخول")').first().click();
  await page.waitForSelector('#founderDashboardScreen', { timeout: 30000 });
  await page.waitForTimeout(3000);

  // 2) فتح تبويب الملاحظات
  await page.locator('.founder-tab[data-tab="founder-notes"]').click();
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const panel = document.getElementById('tab-founder-notes');
    return {
      panelVisible: !!(panel && panel.classList.contains('active')),
      titleInput: !!document.getElementById('fnTitle'),
      bodyInput: !!document.getElementById('fnBody'),
      audienceValue: (document.getElementById('fnAudience') || {}).value,
      notesCount: (document.getElementById('fnCount') || {}).textContent,
      aiChatBox: !!document.getElementById('fnAiChatMessages'),
      chips: [...document.querySelectorAll('button')].filter(b => b.textContent.includes('صياغة')).length,
      chatCard: !!document.getElementById('fnGmChatCard'),
      chatListBtns: document.querySelectorAll('#fnGmChatList button').length
    };
  });

  // 3) اختبر chip → النص يروح لمربع الكتابة
  const chip = page.locator('button:has-text("صياغة تعليمات")').first();
  if ((await chip.count()) > 0) {
    await chip.click();
    await page.waitForTimeout(300);
    result.chipWorks = await page.evaluate(() =>
      (document.getElementById('fnAiChatInput') || {}).value || '(فاضي)'
    );
  }

  // 4) اختبر اختيار "مدير محدد"
  try {
    await page.selectOption('#fnAudience', 'specific');
    await page.waitForTimeout(800);
    result.specific = await page.evaluate(() => ({
      display: (document.getElementById('fnSpecificWrap') || {}).style?.display,
      gmCheckboxes: document.querySelectorAll('.fn-gm-target').length
    }));
  } catch (e) { result.specific = 'selectOption failed: ' + e.message; }

  // 5) اكتب ملاحظة كاملة واحفظها
  try {
    await page.fill('#fnTitle', 'تعليمات تجريبية للمدير العام');
    await page.fill('#fnBody', 'ملاحظة اختبار: راجع الطلبات الجديدة يومياً وحدّث حالة الشحن.');
    await page.selectOption('#fnPriority', 'high');
    await page.click('#fnSaveBtn');
    await page.waitForTimeout(2500);
    result.saved = await page.evaluate(() => ({
      count: (document.getElementById('fnCount') || {}).textContent,
      firstCard: (document.querySelector('#fnList .fn-card') || {}).textContent?.slice(0, 120)
    }));
  } catch (e) { result.saveError = e.message; }

  // 6) افتح شات مدير (لو فيه)
  try {
    const gmBtn = page.locator('#fnGmChatList button').first();
    if ((await gmBtn.count()) > 0) {
      await gmBtn.click();
      await page.waitForTimeout(1500);
      result.chatOpened = await page.evaluate(() => ({
        panelShown: (document.getElementById('fnChatPanel') || {}).style?.display,
        peer: (document.getElementById('fnChatPeerName') || {}).textContent
      }));
    } else { result.chatOpened = 'لا يوجد مدراء للدردشة'; }
  } catch (e) { result.chatError = e.message; }

  await page.screenshot({ path: '_qa_notes_final.png' });
  return result;
}
