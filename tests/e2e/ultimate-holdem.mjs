// Ultimate Texas Hold'em e2e：三模式、Blind 同步、練習三階段、提示、教學全步驟（含測驗）、真實倒數與逾時。
const ID = 'ultimate-holdem';

const visible = (id) => `[data-action="${id}"]:not([hidden])`;
async function waitStage(page, id) { await page.waitForSelector(visible(id)); }

export default async function (t) {
  await t.test('三模式皆可進入、data-bet 齊全、390px 不溢出', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      for (const s of ['ante', 'blind', 'trips', 'play']) h.assert(await page.$(`[data-bet="${s}"]`), `缺 data-bet=${s}`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode} 橫向溢出 ${w}`);
    }
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('500'), '真實模式進場說明限注：' + txt);
  });

  await t.test('練習：Ante 自動同步 Blind；過牌 → 過牌 → 河牌 1× → 結果', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'ante', 25);
    h.assertEq(await h.betAmount(page, 'blind'), 25, 'Blind 同步');
    await h.placeChip(page, 'blind', 25);
    h.assertEq(await h.betAmount(page, 'blind'), 25, 'Blind 不能單獨加');
    await h.placeChip(page, 'trips', 10);
    h.assertEq(await page.$eval('[data-role="total"]', (e) => Number(e.dataset.total)), 60, '總注 60');
    await h.deal(page);
    await waitStage(page, 'raise4');
    h.assert(await page.isVisible(visible('raise3')) && await page.isVisible(visible('check')), '翻牌前 Check/3×/4×');
    h.assert(!(await page.isVisible(visible('fold'))), '翻牌前不能棄牌');
    h.assertEq(await h.balance(page), 940, '發牌後扣 Ante + Blind + Trips');
    await page.click('[data-action="check"]');
    await waitStage(page, 'raise2');
    h.assertEq(await page.$$eval('.uth-board .lg-card', (e) => e.length), 3, '翻牌 3 張');
    await page.click('[data-action="check"]');
    await waitStage(page, 'raise1');
    h.assert(await page.isVisible(visible('fold')) && !(await page.isVisible(visible('check'))), '河牌只有 Fold/1×');
    await page.click('[data-action="raise1"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const handTxt = await page.textContent('.lg-result__v[data-k="hand"]');
    h.assert(handTxt.includes('公共牌') && handTxt.includes('最佳 5 張') && handTxt.includes('合格'), '牌型段：' + handTxt);
    const formula = await page.textContent('.lg-result__v[data-k="formula"]');
    for (const k of ['Ante', 'Blind', 'Play', 'Trips']) h.assert(formula.includes(k), `計算式含 ${k}：` + formula);
    const net = await page.evaluate(() => LG.stats.get('ultimate-holdem').net);
    h.assertEq(await h.balance(page), 1000 + net, '餘額 = 1000 + 淨額');
  });

  await t.test('練習：翻牌前 4× 直接攤牌；提示顯示建議', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    if ((await page.getAttribute('[data-action="hints"]', 'aria-checked')) !== 'true') await page.click('[data-action="hints"]');
    await h.placeChip(page, 'ante', 10);
    await h.deal(page);
    await waitStage(page, 'raise4');
    const hint = await page.textContent('.uth-hint');
    h.assert(hint.includes('建議') && await page.isVisible('.uth-hint'), '提示：' + hint);
    h.assert(await page.isVisible('.lg-strategy'), '策略面板');
    await page.click('[data-action="raise4"]');
    await h.waitResult(page);
    h.assertEq(await page.$$eval('.uth-board .lg-card', (e) => e.length), 5, '加注後直接翻完 5 張');
    h.assertEq(await page.evaluate(() => LG.modes.instance().state.decisions), 1, '只決定一次');
    h.assert((await page.textContent('.lg-result__v[data-k="formula"]')).includes('4×'), 'Play（4×）');
  });

  await t.test('教學：走完全部步驟（含 3 題測驗），每步 highlight 存在', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    const total = await page.$eval('.lg-tutor__count', (e) => Number(e.textContent.split('/')[1]));
    h.assert(total >= 14, '步數 ' + total);
    for (let i = 0; i < total; i++) {
      const st = await h.tutorialStep(page);
      h.assertEq(st.index, i, '步驟序');
      await page.waitForTimeout(40);
      const sels = await page.evaluate(() => LG.modes.instance().tutorialSteps()[Number(document.querySelector('.lg-tutor').dataset.index)].highlight);
      if (sels) {
        for (const s of sels) h.assert(await page.$(s), `步驟 ${st.id} highlight 不存在：${s}`);
        await page.waitForSelector('.lg-spot--hl');
      }
      if (st.id === 'flow-ante') {
        await h.placeChip(page, 'ante', 25);
        h.assertEq(await h.betAmount(page, 'blind'), 25, '教學：Blind 自動同額');
      }
      if (st.id === 'flow-deal') { await h.deal(page); await waitStage(page, 'raise4'); }
      if (st.id === 'flow-preflop') { await page.click('[data-action="raise4"]'); await h.waitResult(page); await h.closeResult(page); }
      if (st.id.startsWith('strategy-quiz')) {
        const q = 'q' + st.id.slice(-1);
        const btns = await page.$$(`[data-uth-quiz="${q}"]`);
        h.assert(btns.length === 2, '測驗按鈕');
        const wrong = await page.$(`[data-uth-quiz="${q}"]:not([data-answer="${await btns[0].getAttribute('data-correct')}"])`);
        await wrong.click();
        await page.click('[data-tutor="next"]', { force: true });
        h.assertEq((await h.tutorialStep(page)).index, i, '答錯不能下一步');
        await page.click(`[data-uth-quiz="${q}"][data-answer="${await btns[0].getAttribute('data-correct')}"]`);
      }
      if (i < total - 1) await h.tutorialNext(page);
    }
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-mode="practice"][data-ready="1"]');
    h.assertEq(await page.evaluate(() => LG.progress.pct('ultimate-holdem')), 100, '教學完成度 100%');
  });

  await t.test('真實：倒數、口令、每階段 30 秒逾時 → Check / Check / Fold', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'ante', 25);
    h.assertEq(await h.betAmount(page, 'blind'), 25, 'Blind 同步');
    await h.waitBanner(page, 'Check or raise?');
    await waitStage(page, 'raise4');
    await h.waitCountdown(page);
    h.assert(!(await page.isVisible('.uth-badge:not(:empty)')), '真實模式不顯示牌型標籤');
    const f0 = await h.flashCount(page);
    // 不操作：翻牌前、翻牌後逾時過牌，河牌逾時棄牌 → −RM 50（Ante + Blind）
    await waitStage(page, 'raise2');
    await waitStage(page, 'raise1');
    const fl = await h.waitFlash(page, f0, 10000);
    h.assertEq(fl.net, -50, '逾時棄牌輸 Ante + Blind');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq(await h.balance(page), 950, '餘額');
    // 下一局：翻牌前 4× → 攤牌閃示
    await h.waitBanner(page, 'Place your bets', 10000);
    await h.placeChip(page, 'ante', 25);
    await waitStage(page, 'raise4');
    const f1 = await h.flashCount(page);
    await page.click('[data-action="raise4"]');
    await h.waitFlash(page, f1);
  });
}
