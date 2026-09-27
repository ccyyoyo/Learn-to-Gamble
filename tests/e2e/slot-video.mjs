// slot-video e2e：三模式、練習轉一次、seed 觸發免費轉並自動轉完、線號亮線、教學前 3 步、真實模式
const ID = 'slot-video';

async function spinOnce(page, h, { real = false } = {}) {
  const before = await h.balance(page);
  const bet = await page.$eval('.lg-betpanel__total', (e) => Number(e.dataset.totalBet));
  const flashes = real ? await h.flashCount(page) : 0;
  const net0 = await page.evaluate((id) => LG.stats.get(id).net, ID);
  await page.click('[data-action="spin"]');
  if (real) await h.waitFlash(page, flashes, 60000);
  else await h.waitResult(page, 60000);
  await page.waitForFunction(() => !document.querySelector('.lg-slot.is-spinning'));
  const after = await h.balance(page);
  const net = await page.evaluate((id) => LG.stats.get(id).net, ID);
  h.assert(Math.abs((after - before) - (net - net0)) < 1e-6, `餘額變化 ${after - before} ≠ 統計淨額 ${net - net0}`);
  h.assert(after - before >= -bet - 1e-9, `最多輸總注 ${bet}`);
  return { before, bet, after };
}

export default async function (t) {
  await t.test('三模式皆可進入、390px 不溢出', async (page, h) => {
    for (const m of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, m);
      h.assertEq(await page.$$eval('.lg-reel', (e) => e.length), 5, `${m} 5 軸`);
      h.assertEq(await page.$$eval('.sv-lineno', (e) => e.length), 20, `${m} 20 個線號`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${m} 橫向溢出 ${w}`);
    }
  });

  await t.test('練習：轉一次、餘額扣除正確、結果面板四段', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.evaluate(() => LG.rng.seed(7));
    const r = await spinOnce(page, h);
    h.assertEq(r.bet, 2, '預設 20 線 × RM 0.10');
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('未中獎，本次投入 RM 2.00') || f.includes('× RM 0.10'), f);
  });

  await t.test('練習：seed 觸發免費轉、背景變色、自動轉完', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.evaluate(() => LG.rng.seed(1));
    const before = await h.balance(page);
    await page.click('[data-action="spin"]');
    await page.waitForSelector('.sv-free:not([hidden])');
    h.assert(await page.$('.lg-game.is-free'), '免費轉背景');
    h.assert((await page.textContent('.sv-free')).includes('LEFT'), '剩餘次數');
    h.assert(await page.$('[data-action="spin"]:disabled'), '免費轉中不能按 SPIN');
    await h.waitResult(page, 60000);
    const st = await page.evaluate(() => { const s = LG.modes.instance().state; return { played: s.freeSpinsPlayed, free: s.free, phase: s.phase }; });
    h.assert(st.played >= 10, '免費轉次數 ' + st.played);
    h.assertEq(st.free, null, '免費轉結束');
    h.assert(await page.$('.sv-free[hidden]'), '計數器收起');
    h.assert(!(await page.$('.lg-game.is-free')), '背景還原');
    const after = await h.balance(page);
    const net = await page.evaluate(() => LG.stats.get('slot-video').net);
    h.assert(Math.abs(after - before - net) < 1e-6, `餘額變化 ${after - before} = 統計 ${net}`);
    h.assert(after - before >= 2, '觸發本身即時獎總注 ×2 → 至少回本');
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('免費轉') && f.includes('金幣'), f);
  });

  await t.test('練習：點線號亮線、Pay Table、餘額不足', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.click('.sv-lineno[data-line="4"]');
    h.assertEq(await page.$$eval('.lg-slot__lines polyline', (e) => e.length), 1, '畫出一條線');
    h.assert(await page.$('.sv-lineno[data-line="4"].is-on'), '線號亮起');
    await page.click('[data-action="paytable"]');
    const pt = await page.textContent('.lg-modal');
    h.assert(pt.includes('× 每線注') && pt.includes('不是總注'), 'Pay Table 說明');
    await page.click('.lg-modal .lg-btn--primary');
    await h.setBalance(page, 1);
    await page.waitForSelector('[data-action="spin"]:disabled');
    h.assert((await h.toastText(page)).includes('餘額不足'), '提示餘額不足');
    await page.click('[data-action="lines-down"]'); // 10 線 = RM 1.00
    await page.waitForSelector('[data-action="spin"]:not(:disabled)');
  });

  await t.test('教學：前 3 步可前進且 highlight 存在（第 2 步點線號）', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction(() => document.querySelectorAll('.lg-spot--hl').length > 0);
      const st = await h.tutorialStep(page);
      h.assertEq(st.index, i, '步驟');
      if (st.id === 'layout-lines') await page.click('.sv-lineno[data-line="4"]', { force: true });
      await h.tutorialNext(page);
    }
    h.assertEq((await h.tutorialStep(page)).index, 3);
    const missing = await page.evaluate(() => {
      const inst = LG.modes.instance();
      return inst.tutorialSteps().flatMap((s) => (s.highlight || []).filter((sel) => !document.querySelector(sel)).map((sel) => `${s.id}:${sel}`));
    });
    h.assertEq(missing.join(' '), '', '不存在的 highlight');
  });

  await t.test('真實模式：固定 20 線、無倒數、只閃金額、餘額正確', async (page, h) => {
    await h.openGame(page, ID, 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('沒有倒數') && txt.includes('RM 2.00'), '進場說明：' + txt);
    await h.startReal(page);
    await page.waitForSelector('[data-action="spin"]:not(:disabled)');
    h.assert(await page.$('.sv-lines[hidden]'), '真實模式線數固定');
    await spinOnce(page, h, { real: true });
    h.assert(!(await page.$('.lg-result')), '沒有結果面板');
    h.assert(!(await page.$('.lg-countdown.is-active')), '沒有倒數');
  });
}
