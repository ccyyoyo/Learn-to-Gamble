// Casino Hold'em e2e：三模式、練習一局（跟注/棄牌）、提示、教學全步驟、真實模式倒數與決策逾時。
const ID = 'casino-holdem';

async function waitDecision(page) {
  await page.waitForSelector('[data-action="call"]:not([hidden])');
}

export default async function (t) {
  await t.test('三模式皆可進入、data-bet 齊全、390px 不溢出', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      for (const s of ['ante', 'call', 'aa']) h.assert(await page.$(`[data-bet="${s}"]`), `缺 data-bet=${s}`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode} 橫向溢出 ${w}`);
    }
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('500'), '真實模式進場說明限注：' + txt);
    const spotTxt = await page.textContent('[data-bet="ante"]');
    h.assert(spotTxt.includes('底注') && /ante/i.test(spotTxt) && spotTxt.includes(':'), 'Ante 格中英+賠率：' + spotTxt);
  });

  await t.test('練習：Ante + AA → 發牌 → 跟注 → 四段結果', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'ante', 25);
    await h.placeChip(page, 'aa', 10);
    h.assertEq(await h.betAmount(page, 'ante'), 25, 'Ante 25');
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await waitDecision(page);
    h.assertEq(await h.balance(page), 1000 - 35, '發牌後扣 Ante + AA');
    await page.click('[data-action="call"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const handTxt = await page.textContent('.lg-result__v[data-k="hand"]');
    h.assert(handTxt.includes('公共牌') && handTxt.includes('最佳 5 張') && handTxt.includes('合格'), '牌型段：' + handTxt);
    const formula = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(formula.includes('Ante') && formula.includes('Call') && formula.includes('AA'), '每注計算式：' + formula);
    const net = await page.evaluate(() => LG.stats.get('casino-holdem').net);
    h.assertEq(await h.balance(page), 1000 + net, '餘額 = 1000 + 淨額');
    h.assertEq(await page.evaluate(() => LG.stats.get('casino-holdem').rounds), 1, '記 stats');
  });

  await t.test('練習：棄牌只輸 Ante；未押 Ante 不能發牌；提示開關', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'aa', 10);
    await h.deal(page);
    h.assert((await h.toastText(page)).includes('Ante'), '只押 AA 不能發牌');
    await h.removeChip(page, 'aa');
    if ((await page.getAttribute('[data-action="hints"]', 'aria-checked')) !== 'true') await page.click('[data-action="hints"]');
    await h.placeChip(page, 'ante', 50);
    await h.deal(page);
    await waitDecision(page);
    const hint = await page.textContent('.ch-hint');
    h.assert(hint.includes('建議') && await page.isVisible('.ch-hint'), '提示顯示建議：' + hint);
    h.assert(await page.isVisible('.lg-strategy'), '策略面板');
    await page.click('[data-action="hints"]');
    h.assert(!(await page.isVisible('.ch-hint')) && !(await page.isVisible('.lg-strategy')), '關閉提示後隱藏');
    await page.click('[data-action="fold"]');
    await h.waitResult(page);
    h.assertEq(await h.balance(page), 950, '棄牌只輸 Ante');
    h.assert((await page.textContent('.lg-result__v[data-k="why"]')).includes('如果跟注'), '棄牌說明含如果跟注');
  });

  await t.test('教學：走完全部步驟，每步 highlight 存在', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    const total = await page.$eval('.lg-tutor__count', (e) => Number(e.textContent.split('/')[1]));
    h.assert(total >= 12, '步數 ' + total);
    for (let i = 0; i < total; i++) {
      const st = await h.tutorialStep(page);
      h.assertEq(st.index, i, '步驟序');
      await page.waitForTimeout(40);
      const sels = await page.evaluate(() => {
        const inst = LG.modes.instance();
        const s = inst.tutorialSteps()[Number(document.querySelector('.lg-tutor').dataset.index)];
        return s.highlight;
      });
      if (sels) {
        for (const s of sels) h.assert(await page.$(s), `步驟 ${st.id} highlight 不存在：${s}`);
        await page.waitForSelector('.lg-spot--hl');
      }
      if (st.id === 'flow-ante') await h.placeChip(page, 'ante', 25);
      if (st.id === 'flow-deal') { await h.deal(page); await waitDecision(page); }
      if (st.id === 'flow-decide') { await page.click('[data-action="call"]'); await h.waitResult(page); await h.closeResult(page); }
      if (i < total - 1) await h.tutorialNext(page);
    }
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-mode="practice"][data-ready="1"]');
    h.assertEq(await page.evaluate(() => LG.progress.pct('casino-holdem')), 100, '教學完成度 100%');
  });

  await t.test('真實：倒數、口令、跟注、只閃金額；決策逾時視為棄牌', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'ante', 25);
    await h.waitBanner(page, 'Play or fold?');
    await waitDecision(page);
    await h.waitCountdown(page);
    h.assert(!(await page.isVisible('.ch-badge:not(:empty)')), '真實模式不顯示牌型標籤');
    const f0 = await h.flashCount(page);
    await page.click('[data-action="call"]');
    const flash = await h.waitFlash(page, f0);
    h.assert(typeof flash.net === 'number', 'payoutFlash');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    // 下一局：押注後不決策 → 30 秒（測試 ×0.1）逾時棄牌
    await h.waitBanner(page, 'Place your bets', 10000);
    const bal = await h.balance(page);
    await h.placeChip(page, 'ante', 25);
    await waitDecision(page);
    const f1 = await h.flashCount(page);
    const fl2 = await h.waitFlash(page, f1, 10000);
    h.assertEq(fl2.net, -25, '逾時棄牌 −RM 25');
    h.assertEq(await h.balance(page), bal - 25, '餘額');
  });
}
