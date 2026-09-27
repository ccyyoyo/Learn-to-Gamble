// slot-holdspin e2e：三模式、練習轉一次驗餘額、強制觸發 Hold & Spin、教學全程、真實模式轉一次。
const ID = 'slot-holdspin';

async function spinOnce(page) {
  await page.waitForSelector('[data-action="spin"]:not([disabled])');
  await page.click('[data-action="spin"]');
}
const inst = (page, expr) => page.evaluate(expr);

export default async function (t) {
  await t.test('三模式皆可進入、無溢出、Pay Table', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      h.assert(await page.$('.hs-machine .lg-slot'), mode + ' 轉軸');
      h.assertEq(await page.$$eval('.hs-jp', (e) => e.length), 3, '三塊獎金牌');
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode} 無橫向溢出 ${w}`);
    }
    await h.openGame(page, ID, 'practice');
    await page.click('.lg-paytable-btn');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('Hold & Spin') && txt.includes('GRAND') && txt.includes('財神'), 'Pay Table 含特色說明');
  });

  await t.test('練習：轉一次，餘額 = 1000 − 總注 + 贏分，結果面板四段', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    h.assertEq(await page.getAttribute('.lg-betpanel__total', 'data-total-bet'), '2', '預設總注 RM 2');
    await spinOnce(page);
    await h.waitResult(page);
    const last = await inst(page, () => LG.modes.instance().state.last);
    h.assertEq(last.bet, 2, '總注');
    h.assertEq(await h.balance(page), Math.round((1000 - 2 + last.win) * 100) / 100, '餘額');
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    h.assertEq(await page.evaluate(() => LG.stats.get('slot-holdspin').rounds), 1, '記 stats');
    const jp = await page.evaluate(() => LG.store.get().jackpots['slot-holdspin']);
    h.assert(Math.abs(jp.major - 500.01) < 1e-6 && Math.abs(jp.grand - 5000.02) < 1e-6, '獎池成長 ' + JSON.stringify(jp));
    h.assert(await page.isVisible('.hs-hint'), '提示開啟時顯示');
  });

  await t.test('練習：強制 6 顆金球 → Hold & Spin 跑完並加總', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.evaluate(() => LG.modes.instance().demo.forceTrigger(6));
    await spinOnce(page);
    await page.waitForSelector('.hs-machine.is-feature');
    await page.waitForSelector('.hs-reels .lg-slot__cell.is-locked');
    await h.waitResult(page, 20000);
    const s = await inst(page, () => LG.modes.instance().state);
    h.assertEq(s.features, 1, '特色一次');
    h.assert(s.last.feature && s.last.orbs === 6, '6 顆觸發');
    h.assert(s.last.win >= 12, '至少 6 顆 × RM 2：' + s.last.win);
    h.assertEq(await h.balance(page), Math.round((998 + s.last.win) * 100) / 100, '餘額含特色');
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('Hold & Spin'), '算式含特色明細：' + f);
    h.assert(await page.$('[data-action="spin"]:not([disabled])'), '可再轉');
  });

  await t.test('教學：全部步驟可走完、高亮存在', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    for (let guard = 0; guard < 40; guard++) {
      const st = await h.tutorialStep(page);
      await page.waitForTimeout(60);
      if (st.id !== 'strategy-intro') h.assert((await h.highlighted(page)) > 0, `步驟 ${st.id} 高亮存在`);
      if (st.id === 'layout-lines') await page.click('[data-action="linebet-up"]');
      if (st.id === 'layout-paytable') { await page.click('.lg-paytable-btn'); await page.click('.lg-modal .lg-btn--primary'); }
      if (st.id === 'flow-spin' || st.id === 'flow-try') {
        await spinOnce(page);
        await h.waitResult(page, 20000);
        await h.closeResult(page);
      }
      const last = await page.getAttribute('[data-tutor="next"]', 'data-last');
      if (last === '1') { await page.click('[data-tutor="next"]'); break; }
      await h.tutorialNext(page);
    }
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
    h.assertEq(await page.evaluate(() => LG.progress.pct('slot-holdspin')), 100, '教學完成度 100%');
  });

  await t.test('真實：無倒數、轉一次只閃金額、餘額正確', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitBanner(page, 'Press SPIN');
    const n0 = await h.flashCount(page);
    await spinOnce(page);
    const fl = await h.waitFlash(page, n0, 20000);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assert(!(await page.$('.lg-countdown.is-active')), '不倒數');
    h.assertEq(await h.balance(page), Math.round((1000 + fl.net) * 100) / 100, '餘額 = 1000 + 淨額');
    h.assertEq(await page.evaluate(() => LG.stats.session.current().rounds), 1, 'session 記一局');
  });

  await t.test('真實：餘額低於總注 → 籌碼用完覆蓋層', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.setBalance(page, 1);
    await page.waitForSelector('[data-action="spin"]:not([disabled])');
    await page.click('[data-action="spin"]');
    await page.waitForSelector('.lg-broke');
    h.assertEq(await h.balance(page), 1, '沒有扣款');
  });
}
