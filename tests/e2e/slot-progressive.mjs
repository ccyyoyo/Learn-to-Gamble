// slot-progressive e2e：三模式、練習轉一次驗餘額、強制輪盤（非最大注沒 GRAND / 最大注 GRAND 回種子）、教學全程、真實模式轉一次。
const ID = 'slot-progressive';

async function spinOnce(page) {
  await page.waitForSelector('[data-action="spin"]:not([disabled])');
  await page.click('[data-action="spin"]');
}
async function collectWheel(page) {
  await page.waitForSelector('[data-action="wheel-collect"]:not([disabled])', { timeout: 15000 });
  const level = await page.$eval('.pg-wheel__label.is-hit', (e) => e.dataset.level);
  await page.click('[data-action="wheel-collect"]');
  return level;
}

export default async function (t) {
  await t.test('三模式皆可進入、無溢出、GRAND 牌 MAX BET ONLY', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      h.assertEq(await page.$$eval('.pg-jp', (e) => e.length), 4, mode + ' 四塊獎金牌');
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode} 無橫向溢出 ${w}`);
    }
    await h.openGame(page, ID, 'practice');
    h.assert(await page.$('[data-jp="grand"].is-inactive'), '預設非最大注：GRAND 半透明');
    h.assert((await page.textContent('[data-jp="grand"]')).includes('MAX BET ONLY'), '標示僅最大注');
    await page.click('[data-action="maxbet"]');
    h.assert(!(await page.$('[data-jp="grand"].is-inactive')), '最大注：GRAND 亮起');
    h.assertEq(await page.getAttribute('.lg-betpanel__total', 'data-total-bet'), '100', '最大注 RM 100');
    await page.click('.lg-paytable-btn');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('Jackpot Wheel') && txt.includes('MINI') && txt.includes('最大注'), 'Pay Table 含輪盤說明');
  });

  await t.test('練習：轉一次，餘額 = 1000 − 總注 + 贏分，四級獎池成長', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await spinOnce(page);
    await h.waitResult(page);
    const last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.bet, 2, '總注');
    h.assertEq(await h.balance(page), Math.round((1000 - 2 + last.win) * 100) / 100, '餘額');
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    const jp = await page.evaluate(() => LG.store.get().jackpots['slot-progressive']);
    h.assert(Math.abs(jp.mini - 20.01) < 1e-6 && Math.abs(jp.grand - 10000.024) < 1e-6, '獎池成長 ' + JSON.stringify(jp));
    h.assert(await page.isVisible('.pg-hint'), '提示開啟時顯示');
  });

  await t.test('練習：非最大注輪盤沒有 GRAND；最大注中 GRAND 後回種子', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.evaluate(() => LG.modes.instance().demo.forceTrigger(0)); // 第 0 格 = GRAND 格
    await spinOnce(page);
    await page.waitForSelector('.pg-wheel');
    const levels = await page.$$eval('.pg-wheel__label', (e) => e.map((x) => x.dataset.level));
    h.assertEq(levels.length, 12, '12 格');
    h.assert(!levels.includes('grand'), '非最大注沒有 GRAND 格');
    h.assertEq(await collectWheel(page), 'major', 'GRAND 格變 MAJOR');
    await h.waitResult(page);
    let last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assertEq(last.wheel, 'major', '中 MAJOR');
    h.assertEq(await h.balance(page), Math.round((998 + last.win) * 100) / 100, '餘額（按比例派彩）');
    h.assertEq(await page.evaluate(() => LG.store.get().jackpots['slot-progressive'].major), 500, 'MAJOR 回種子');
    await h.closeResult(page);

    await page.click('[data-action="maxbet"]');
    await page.evaluate(() => LG.modes.instance().demo.forceTrigger(0));
    const before = await h.balance(page);
    await spinOnce(page);
    await page.waitForSelector('.pg-wheel');
    const levels2 = await page.$$eval('.pg-wheel__label', (e) => e.map((x) => x.dataset.level));
    h.assertEq(levels2.filter((x) => x === 'grand').length, 1, '最大注有 1 格 GRAND');
    h.assertEq(await collectWheel(page), 'grand', '中 GRAND');
    await h.waitResult(page);
    last = await page.evaluate(() => LG.modes.instance().state.last);
    h.assert(last.win >= 10000, 'GRAND 全額 ' + last.win);
    h.assertEq(await h.balance(page), Math.round((before - 100 + last.win) * 100) / 100, '餘額含 GRAND');
    h.assertEq(await page.evaluate(() => LG.store.get().jackpots['slot-progressive'].grand), 10000, 'GRAND 回種子');
    h.assertEq(await page.textContent('[data-role="jp-grand"]'), 'RM 10,000.00', '獎金牌顯示種子');
  });

  await t.test('教學：全部步驟可走完、高亮存在', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    const bodies = [];
    for (let guard = 0; guard < 40; guard++) {
      const st = await h.tutorialStep(page);
      bodies.push(await page.textContent('.lg-tutor__body'));
      await page.waitForTimeout(60);
      if (st.id !== 'strategy-intro') h.assert((await h.highlighted(page)) > 0, `步驟 ${st.id} 高亮存在`);
      if (st.id === 'layout-paytable') { await page.click('.lg-paytable-btn'); await page.click('.lg-modal .lg-btn--primary'); }
      if (st.id === 'flow-spin') { await spinOnce(page); await h.waitResult(page); await h.closeResult(page); }
      if (st.id === 'flow-try') { await spinOnce(page); await collectWheel(page); await h.waitResult(page); await h.closeResult(page); }
      if (st.id === 'strategy-maxbet') await page.click('[data-action="maxbet"]');
      const last = await page.getAttribute('[data-tutor="next"]', 'data-last');
      if (last === '1') { await page.click('[data-tutor="next"]'); break; }
      await h.tutorialNext(page);
    }
    h.assert(bodies.some((b) => b.includes('就一定要最大注')), '教學講「要玩就一定最大注」');
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
    h.assertEq(await page.evaluate(() => LG.progress.pct('slot-progressive')), 100, '教學完成度 100%');
  });

  await t.test('真實：無倒數、轉一次只閃金額、餘額正確', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitBanner(page, 'Press SPIN');
    const n0 = await h.flashCount(page);
    await spinOnce(page);
    const fl = await h.waitFlash(page, n0, 20000);
    h.assert(!(await page.$('.lg-result')), '沒有結果面板');
    h.assert(!(await page.$('.lg-countdown.is-active')), '不倒數');
    h.assertEq(await h.balance(page), Math.round((1000 + fl.net) * 100) / 100, '餘額 = 1000 + 淨額');
  });
}
