// 番攤 e2e：三模式、練習押番/念/角/單雙 → 開碗撥扣 → 結算（扣佣）、加速鍵、教學、真實倒數
export default async function (t) {
  const ID = 'fantan';
  const noOverflow = async (page, h, what) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, `${what} 無橫向溢出 ${w}`);
  };

  await t.test('三模式皆可進入、28 個下注格齊全', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    const ids = await page.$$eval('[data-bet]', (els) => els.map((e) => e.dataset.bet));
    const expect = await page.evaluate(() => LG.games.fantan.logic.SPOT_IDS);
    h.assertEq(ids.length, 28, 'spot 數');
    h.assert(expect.every((id) => ids.includes(id)), 'spotId 齊全');
    await noOverflow(page, h, '練習');
    await h.openGame(page, ID, 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await noOverflow(page, h, '教學');
    await h.openGame(page, ID, 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 50') && txt.includes('20 秒'), '真實進場說明：' + txt);
  });

  await t.test('練習：押番/念/角/單雙各一注 → 開碗 → 撥扣 → 結算', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    for (const s of ['fan-1', 'nim-2-3', 'kwok-3-4', 'odd']) await h.placeChip(page, s, 10);
    await page.evaluate(() => LG.modes.instance().demo.rig(137));
    await h.deal(page);
    await page.waitForSelector('.ft-center.is-open');
    await page.click('[data-action="fast"]');
    h.assertEq(await page.getAttribute('[data-action="fast"]', 'aria-pressed'), 'true', '加速鍵');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.result, 1, '137 顆 → 開 1');
    h.assertEq(last.lines.length, 4, '4 注');
    // 番 1 贏 28.5、念 2-3 輸、角 3-4 輸、單贏 9.5 → 淨 −2
    h.assertEq(last.net, 28.5 - 10 - 10 + 9.5, '淨額');
    h.assertEq(await h.balance(page), 1000 + last.net, '餘額');
    h.assertEq(await page.$$eval('.ft-pile i', (e) => e.length), 1, '剩 1 顆');
    h.assert(await page.$('[data-bet="fan-1"].is-win'), '番 1 亮');
    h.assert(await page.$('[data-bet="nim-2-1"].ft-push'), '2念1 push');
  });

  await t.test('練習：提示開關顯示機率與 EV', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    const vis = () => page.$eval('[data-bet="fan-1"] .ft-spot__hint', (e) => getComputedStyle(e).display !== 'none');
    const before = await vis();
    await page.click('[data-action="hints"]');
    h.assertEq(await vis(), !before, '提示切換');
  });

  await t.test('教學：前 3 步可前進、有高亮；走完 action', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.ft-square.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.ft-fan.lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2);
    await page.waitForSelector('[data-bet="nim-3-2"].lg-spot--hl');
    while ((await h.tutorialStep(page)).id !== 'layout-chips') await h.tutorialNext(page);
    await h.selectChip(page, 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-place');
    await h.placeChip(page, 'fan-3');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page); // flow-open
    await h.deal(page);
    await h.waitResult(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.result, 3, '教學預設 63 顆 → 開 3');
    h.assertEq(last.net, 142.5, '番 3 RM 50 × 3 × 0.95');
    await h.closeResult(page);
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') {
      const s = await h.tutorialStep(page);
      if (s.id === 'payout-try') { await h.placeChip(page, 'kwok-1-2'); await page.waitForSelector('.lg-tutor__action.is-done'); }
      await h.tutorialNext(page);
      const cur = await h.tutorialStep(page);
      if (cur.id !== 'strategy-edge') await page.waitForSelector('.lg-spot--hl', { timeout: 2000 }).catch(() => { throw new Error('沒有高亮：' + cur.id); });
    }
    await page.click('[data-tutor="next"]');
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
  });

  await t.test('真實：倒數、口令、只閃金額', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'odd', 50);
    await h.waitBanner(page, 'No more bets', 6000);
    const flash = await h.waitFlash(page, 0, 15000);
    h.assert(flash.net === 47.5 || flash.net === -50, '閃示 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實沒有結果面板');
    h.assertEq(await h.balance(page), 1000 + flash.net, '餘額');
  });
}
