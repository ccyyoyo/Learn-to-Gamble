// slot-classic e2e：三模式、練習轉一次（餘額 = 前 − 押注 + 贏分）、餘額不足、教學前 3 步、真實模式
const ID = 'slot-classic';

async function spinOnce(page, h, { real = false } = {}) {
  const before = await h.balance(page);
  const bet = await page.$eval('.lg-betpanel__total', (e) => Number(e.dataset.totalBet));
  const flashes = real ? await h.flashCount(page) : 0;
  await page.click('[data-action="spin"]');
  if (real) await h.waitFlash(page, flashes);
  else await h.waitResult(page);
  await page.waitForFunction(() => !document.querySelector('.lg-slot.is-spinning'));
  const win = await page.evaluate(() => LG.modes.instance().state.lastWin);
  const after = await h.balance(page);
  h.assert(Math.abs(after - (before - bet + win)) < 1e-6, `餘額 ${before} − ${bet} + ${win} ≠ ${after}`);
  return { before, bet, win, after };
}

export default async function (t) {
  await t.test('三模式皆可進入、390px 不溢出', async (page, h) => {
    for (const m of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, m);
      h.assert(await page.$('.sc-machine'), `${m} 有機台`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${m} 橫向溢出 ${w}`);
    }
    h.assert(!(await page.$('.lg-chips')), '老虎機不用籌碼盤');
  });

  await t.test('練習：SPIN 後 3 軸停止、餘額扣除正確、結果面板四段', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    h.assertEq(await page.$$eval('.lg-reel', (e) => e.length), 3, '3 軸');
    const r = await spinOnce(page, h);
    h.assertEq(r.bet, 0.5, '預設押注 5 credits × RM 0.10');
    const syms = await page.$$eval('.lg-slot__cell', (e) => e.map((x) => x.dataset.sym));
    h.assertEq(syms.length, 9, '9 格');
    h.assert(syms.every((s) => 'GRBX'.includes(s)), '符號 ' + syms.join(''));
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    const formula = await page.textContent('.lg-result__v[data-k="formula"]');
    if (r.win === 0) h.assert(formula.includes('未中獎，本次投入 RM 0.50'), formula);
    else h.assert(formula.includes('×'), formula);
    h.assertEq(await page.evaluate(() => LG.stats.get('slot-classic').rounds), 1, '記 stats');
    // 再轉一次（MAX BET）
    await h.closeResult(page);
    await page.click('[data-action="maxbet"]');
    h.assertEq(await page.$eval('.lg-betpanel__total', (e) => Number(e.dataset.totalBet)), 25, 'MAX BET = RM 25');
    await spinOnce(page, h);
  });

  await t.test('練習：餘額不足 SPIN 停用 + 提示；Pay Table；提示開關', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.setBalance(page, 0.3);
    await page.waitForSelector('[data-action="spin"]:disabled');
    h.assert((await h.toastText(page)).includes('餘額不足'), '提示餘額不足');
    // 降到 1 credit（RM 0.10）→ 可以轉
    for (let i = 0; i < 4; i++) await page.click('[data-action="lines-down"]');
    await page.waitForSelector('[data-action="spin"]:not(:disabled)');
    await page.click('[data-action="paytable"]');
    const pt = await page.textContent('.lg-modal');
    h.assert(pt.includes('× 每線注') && pt.includes('1000×'), 'Pay Table 內容');
    await page.click('.lg-modal .lg-btn--primary');
    h.assert(await page.$('.sc-hint:not([hidden])'), '提示預設開啟');
    await page.click('[data-action="hints"]');
    await page.waitForSelector('.sc-hint[hidden]', { state: 'attached' });
  });

  await t.test('教學：前 3 步可前進且 highlight 存在（第 3 步調面額）', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction(() => document.querySelectorAll('.lg-spot--hl').length > 0);
      const st = await h.tutorialStep(page);
      h.assertEq(st.index, i, '步驟');
      if (st.id === 'layout-denom') { await page.click('[data-action="linebet-up"]'); await page.click('[data-action="linebet-up"]'); }
      await h.tutorialNext(page);
    }
    h.assertEq((await h.tutorialStep(page)).index, 3);
    // 所有步驟的 highlight 選擇器都指向存在的元素
    const missing = await page.evaluate(() => {
      const inst = LG.modes.instance();
      return inst.tutorialSteps().flatMap((s) => (s.highlight || []).filter((sel) => !document.querySelector(sel)).map((sel) => `${s.id}:${sel}`));
    });
    h.assertEq(missing.join(' '), '', '不存在的 highlight');
  });

  await t.test('真實模式：無倒數、開始後才能 SPIN、只閃金額、餘額正確', async (page, h) => {
    await h.openGame(page, ID, 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('沒有倒數') && txt.includes('RM 25.00'), '進場說明：' + txt);
    h.assert(await page.$('[data-action="spin"]:disabled'), '按開始前不能轉');
    await h.startReal(page);
    await page.waitForSelector('[data-action="spin"]:not(:disabled)');
    await spinOnce(page, h, { real: true });
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assert(!(await page.$('.lg-countdown.is-active')), '沒有倒數');
    // 破產：押 RM 0.10（1 credit），固定 seed 讓這轉沒中 → 餘額 0 < 最低注 → 籌碼用完覆蓋層
    for (let i = 0; i < 4; i++) await page.click('[data-action="lines-down"]');
    await h.setBalance(page, 0.1);
    await page.evaluate(() => LG.rng.seed(3));
    const r = await spinOnce(page, h, { real: true });
    h.assertEq(r.after, 0, 'seed 3 這轉沒中');
    await page.waitForSelector('.lg-broke');
  });
}
