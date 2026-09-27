// Caribbean Stud Poker e2e（docs/07-test-plan.md §3）
const ID = 'caribbean-stud';

export default async function (t) {
  await t.test('三模式皆可進入、data-bet 齊全、390px 無溢出', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      for (const s of ['ante', 'bet', 'progressive']) h.assert(await page.$(`[data-bet="${s}"] .lg-spot__zh`), `${mode}: 缺 ${s}`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode}: 橫向溢出 ${w}`);
    }
    h.assert(await page.$('[data-action="real-start"]'), '真實模式進場 modal');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('500'), '真實限注 ' + txt);
  });

  await t.test('練習：旁注切換、Bet 格不能手放、Ante → 跟注 → 結果面板四段', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.click('[data-bet="progressive"]');
    h.assertEq(await h.betAmount(page, 'progressive'), 5, '旁注投入 RM 5');
    await page.click('[data-bet="progressive"]');
    h.assertEq(await h.betAmount(page, 'progressive'), 0, '再點取消');
    await h.placeChip(page, 'bet', 25);
    h.assertEq(await h.betAmount(page, 'bet'), 0, 'Bet 格不能手放');
    await h.deal(page);
    h.assert((await h.toastText(page)).includes('Ante'), '沒押 Ante 不能發牌');
    await h.placeChip(page, 'ante', 25);
    await page.click('[data-bet="progressive"]');
    const pool0 = await page.evaluate(() => LG.store.get().jackpots['caribbean-stud'].pool);
    await h.deal(page);
    await page.waitForSelector('[data-action="raise"]:not([hidden]):not([disabled])');
    h.assertEq(await h.balance(page), 970, '發牌後扣 Ante + 旁注');
    const pool1 = await page.evaluate(() => LG.store.get().jackpots['caribbean-stud'].pool);
    h.assertEq(pool1, pool0 + 3.5, '獎池 +3.5');
    await page.click('[data-action="raise"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const res = await page.textContent('.lg-result__v[data-k="result"]');
    h.assert(res.includes('合格') && res.includes('比牌'), '莊是否合格 → 比牌：' + res);
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('底注') && f.includes('跟注') && f.includes('累積獎金'), '每注計算式：' + f);
    const st = await page.evaluate(() => LG.stats.get('caribbean-stud'));
    h.assertEq(st.rounds, 1, '記 stats');
    h.assertEq(await h.balance(page), Math.round((1000 + st.net) * 100) / 100, '餘額 = 1000 + net');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局發牌按鈕');
  });

  await t.test('練習：提示開關（決策時顯示建議）、棄牌', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'ante', 10);
    await h.deal(page);
    await page.waitForSelector('[data-action="fold"]:not([hidden])');
    const on = await page.$eval('.cstud-hint', (e) => !e.hidden);
    if (!on) await page.click('[data-action="hints"]');
    h.assert((await page.textContent('.cstud-hint')).includes('建議'), '決策提示');
    await page.click('[data-action="hints"]');
    h.assert(await page.$eval('.cstud-hint', (e) => e.hidden), '關閉提示');
    await page.click('[data-action="fold"]');
    await h.waitResult(page);
    h.assertEq(await h.balance(page), 990, '棄牌只輸 Ante');
  });

  await t.test('教學：前 3 步可前進且有高亮；action 步驟可完成', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-tutor');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="ante"].lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="bet"].lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'layout-progressive');
    await page.click('[data-bet="progressive"]');
    await page.click('[data-bet="progressive"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    while ((await h.tutorialStep(page)).id !== 'flow-ante') await h.tutorialNext(page);
    await h.placeChip(page, 'ante', 25);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.deal(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-decide');
    await page.click('[data-action="raise"]');
    await h.waitResult(page);
    h.assert((await page.textContent('.lg-result__v[data-k="hand"]')).includes('一對 9'), '指定牌：一對 9');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.closeResult(page);
    await page.click('[data-tutor-section="strategy"]');
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') await h.tutorialNext(page);
    await page.click('[data-tutor="next"]');
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
  });

  await t.test('真實：倒數與口令、只閃金額、30 秒未決定自動棄牌', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'ante', 25);
    await h.waitBanner(page, 'Play or fold?');
    await h.waitCountdown(page);
    const n0 = await h.flashCount(page);
    const flash = await h.waitFlash(page, n0, 10000);   // 30 秒 × 0.1
    h.assertEq(flash.net, -25, '逾時棄牌輸 Ante');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq((await page.evaluate(() => LG.stats.session.current())).rounds, 1, 'session 記一局');
  });

  await t.test('真實：跟注一局', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.placeChip(page, 'ante', 25);
    await page.waitForSelector('[data-action="raise"]:not([hidden]):not([disabled])', { timeout: 8000 });
    const n0 = await h.flashCount(page);
    await page.click('[data-action="raise"]');
    const flash = await h.waitFlash(page, n0);
    h.assert(typeof flash.net === 'number', '閃示 ' + flash.net);
    h.assertEq(await h.balance(page), 1000 + flash.net, '餘額');
  });
}
