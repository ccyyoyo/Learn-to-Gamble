// 骰寶 e2e：三模式、練習下 6 種注 → 搖 → 結算、教學、真實倒數
export default async function (t) {
  const noOverflow = async (page, h, what) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, `${what} 無橫向溢出 ${w}`);
  };

  await t.test('三模式皆可進入、檯面 spotId 齊全、手機不溢出', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    const ids = await page.$$eval('[data-bet]', (els) => els.map((e) => e.dataset.bet));
    const expect = await page.evaluate(() => LG.games.sicbo.logic.SPOT_IDS);
    h.assertEq(ids.length, expect.length, 'spot 數');
    h.assert(expect.every((id) => ids.includes(id)), 'spotId 齊全');
    const texts = await page.$$eval('[data-bet]', (els) => els.every((e) => e.querySelector('.lg-spot__zh') && e.querySelector('.lg-spot__en').textContent && e.querySelector('.lg-spot__odds').textContent));
    h.assert(texts, '每格有中文/英文/賠率');
    await noOverflow(page, h, '練習');
    await h.openGame(page, 'sicbo', 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await noOverflow(page, h, '教學');
    await h.openGame(page, 'sicbo', 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('20 秒'), '真實進場說明：' + txt);
  });

  await t.test('練習：下 6 種注 → 搖盅 → 開盅 → 結算', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    for (const s of ['big', 'single-3', 'double-2', 'total-9', 'combo-1-2', 'anyTriple']) await h.placeChip(page, s, 10);
    h.assertEq(await page.getAttribute('[data-role="total"]', 'data-total'), '60', '總注 60');
    await h.deal(page);
    await page.waitForSelector('.sb-bowl.is-covered');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.lines.length, 6, '6 注結算');
    h.assertEq(await h.balance(page), 1000 + last.net, '餘額 = 1000 + 淨額');
    h.assert(await page.$('.sb-lit'), '中獎格燈亮');
    h.assertEq(await page.$$eval('.sb-dice .sb-die', (e) => e.length), 3, '三顆骰子');
    h.assertEq(await page.$$eval('.sb-hist', (e) => e.length), 1, '紀錄一局');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局可再搖');
  });

  await t.test('練習：提示開關顯示機率與優勢', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    const vis = () => page.$eval('[data-bet="big"] .sb-spot__hint', (e) => getComputedStyle(e).display !== 'none');
    const before = await vis();
    await page.click('[data-action="hints"]');
    h.assertEq(await vis(), !before, '提示切換');
  });

  await t.test('教學：前 3 步可前進、有高亮；走完 action', async (page, h) => {
    await h.openGame(page, 'sicbo', 'tutorial');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="big"].lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2, '第 3 步');
    await page.waitForSelector('[data-bet="odd"].lg-spot--hl');
    // 走到籌碼 action
    while ((await h.tutorialStep(page)).id !== 'layout-chips') await h.tutorialNext(page);
    await h.selectChip(page, 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page); // flow-place
    h.assertEq((await h.tutorialStep(page)).id, 'flow-place');
    await h.placeChip(page, 'big');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page); // flow-shake
    await h.deal(page);
    await h.waitResult(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.sum, 14, '教學預設骰面 3-5-6');
    await h.closeResult(page);
    await h.tutorialNext(page);
    await h.tutorialNext(page); // flow-lit
    await page.waitForSelector('.sb-lit.lg-spot--hl');
    // 每一步的 highlight 都存在
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') {
      const s = await h.tutorialStep(page);
      if (s.id === 'payout-try') { await h.placeChip(page, 'single-4'); await page.waitForSelector('.lg-tutor__action.is-done'); }
      await h.tutorialNext(page);
      const cur = await h.tutorialStep(page);
      if (cur.id !== 'strategy-edge') await page.waitForSelector('.lg-spot--hl', { timeout: 2000 }).catch(() => { throw new Error('沒有高亮：' + cur.id); });
    }
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-game="sicbo"][data-mode="practice"][data-ready="1"]');
  });

  await t.test('真實：倒數、口令、限注、只閃金額', async (page, h) => {
    await h.openGame(page, 'sicbo', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'big', 25);
    await h.selectChip(page, 100);
    await h.placeChip(page, 'triple-2');
    await h.placeChip(page, 'triple-2');
    h.assertEq(await h.betAmount(page, 'triple-2'), 100, '圍骰上限 100');
    h.assert((await h.toastText(page)).includes('上限'), '上限 toast');
    await h.waitBanner(page, 'No more bets', 6000);
    const flash = await h.waitFlash(page);
    h.assert(typeof flash.net === 'number', '閃示 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實沒有結果面板');
    h.assertEq(await h.balance(page), 1000 + flash.net, '餘額');
  });
}
