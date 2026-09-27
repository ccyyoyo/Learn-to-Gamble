// 三公 e2e：三模式、練習押多位 → 發牌 → 結算、3 倍保留、教學、真實倒數
export default async function (t) {
  const ID = 'three-pictures';
  const noOverflow = async (page, h, what) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, `${what} 無橫向溢出 ${w}`);
  };

  await t.test('三模式皆可進入、三個位置 + 莊區 + 印字', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    for (const s of ['seat-1', 'seat-2', 'seat-3']) h.assert(await page.$(`[data-bet="${s}"]`), s);
    h.assert(await page.$('.tp-banker'), '莊區');
    h.assert((await page.textContent('.tp-print')).includes('和局歸莊'), '桌面印字');
    await noOverflow(page, h, '練習');
    await h.openGame(page, ID, 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await noOverflow(page, h, '教學');
    await h.openGame(page, ID, 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 50') && txt.includes('15 秒'), '真實進場說明：' + txt);
  });

  await t.test('練習：押位置 2 + 位置 3 → 發牌 → 逐位開牌 → 結算', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'seat-2', 50);
    await h.placeChip(page, 'seat-3', 25);
    await h.deal(page);
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    h.assertEq(await page.$$eval('.tp-table .lg-card:not(.is-facedown)', (e) => e.length), 12, '12 張全開');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.lines.length, 2, '兩注');
    h.assertEq(await h.balance(page), 1000 + last.net, '餘額 = 1000 + 淨額');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局');
  });

  await t.test('練習：需保留 3 倍注額', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.setBalance(page, 100);
    await h.placeChip(page, 'seat-2', 25);
    await h.placeChip(page, 'seat-2', 25);
    h.assertEq(await h.betAmount(page, 'seat-2'), 25, '100 只能押 25（保留 3 倍）');
    h.assert((await h.toastText(page)).includes('3 倍'), '3 倍保留 toast');
  });

  await t.test('教學：前 3 步可前進、有高亮；走完 action', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.tp-banker.lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2);
    await page.waitForSelector('.tp-seats.lg-spot--hl');
    while ((await h.tutorialStep(page)).id !== 'layout-chips') await h.tutorialNext(page);
    await h.selectChip(page, 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-place');
    await h.placeChip(page, 'seat-2');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page); // flow-deal
    await h.deal(page);
    await h.waitResult(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.net, 100, '教學預設：位置 2 九點 2:1');
    await h.closeResult(page);
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') {
      const s = await h.tutorialStep(page);
      if (s.id === 'payout-try') { await h.placeChip(page, 'seat-1'); await page.waitForSelector('.lg-tutor__action.is-done'); }
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
    await h.placeChip(page, 'seat-2', 50);
    await h.waitBanner(page, 'No more bets', 5000);
    const flash = await h.waitFlash(page);
    h.assert([100, 150, 50, -50, -100, -150].includes(flash.net), '閃示 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實沒有結果面板');
    h.assertEq(await h.balance(page), 1000 + flash.net, '餘額');
  });
}
