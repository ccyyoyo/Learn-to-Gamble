// Three Card Poker e2e（docs/07-test-plan.md §3）
const ID = 'three-card-poker';

export default async function (t) {
  await t.test('三模式皆可進入、data-bet 齊全、390px 無溢出', async (page, h) => {
    for (const mode of ['practice', 'tutorial', 'real']) {
      await h.openGame(page, ID, mode);
      for (const s of ['pairPlus', 'ante', 'play']) h.assert(await page.$(`[data-bet="${s}"] .lg-spot__odds`), `${mode}: 缺 ${s}`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode}: 橫向溢出 ${w}`);
    }
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('500'), '真實限注 ' + txt);
  });

  await t.test('練習：Ante + Pair Plus → 跟注 → 結果面板（合格 → 比牌 → 每注）', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'play', 10);
    h.assertEq(await h.betAmount(page, 'play'), 0, 'Play 格不能手放');
    await h.placeChip(page, 'ante', 25);
    await h.placeChip(page, 'pairPlus', 10);
    await h.deal(page);
    await page.waitForSelector('[data-action="play"]:not([hidden]):not([disabled])');
    h.assertEq(await h.balance(page), 965, '發牌後扣 Ante + Pair Plus');
    await page.click('[data-action="play"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const res = await page.textContent('.lg-result__v[data-k="result"]');
    h.assert(res.includes('合格') && res.includes('比牌'), res);
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('底注') && f.includes('跟注') && f.includes('對子加注'), f);
    const st = await page.evaluate(() => LG.stats.get('three-card-poker'));
    h.assertEq(st.rounds, 1, '記 stats');
    h.assertEq(await h.balance(page), Math.round((1000 + st.net) * 100) / 100, '餘額 = 1000 + net');
  });

  await t.test('練習：只押 Pair Plus 不需決策；提示開關', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await h.placeChip(page, 'pairPlus', 10);
    await h.deal(page);
    await h.waitResult(page);
    h.assert(await page.$eval('[data-action="play"]', (b) => b.hidden), '沒有 Ante 就不用決策');
    await h.closeResult(page);
    await h.placeChip(page, 'ante', 10);
    await h.deal(page);
    await page.waitForSelector('[data-action="fold"]:not([hidden])');
    if (await page.$eval('.tcp-hint', (e) => e.hidden)) await page.click('[data-action="hints"]');
    h.assert((await page.textContent('.tcp-hint')).includes('Q-6-4') || (await page.textContent('.tcp-hint')).includes('跟注'), '決策提示');
    await page.click('[data-action="hints"]');
    h.assert(await page.$eval('.tcp-hint', (e) => e.hidden), '關閉提示');
    await page.click('[data-action="fold"]');
    await h.waitResult(page);
  });

  await t.test('教學：前 3 步可前進且有高亮；發牌與跟注 action', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="pairPlus"].lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="ante"].lg-spot--hl');
    await h.tutorialNext(page);
    while ((await h.tutorialStep(page)).id !== 'flow-ante') await h.tutorialNext(page);
    await page.click('[data-tutor="next"]', { force: true });
    h.assertEq((await h.tutorialStep(page)).id, 'flow-ante', 'action 未完成不能前進');
    await h.placeChip(page, 'ante', 25);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.deal(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-play');
    await page.click('[data-action="play"]');
    await h.waitResult(page);
    h.assert((await page.textContent('.lg-result__v[data-k="hand"]')).includes('K 高牌'), '指定牌 K-7-2');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.closeResult(page);
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') await h.tutorialNext(page);
    await page.click('[data-tutor="next"]');
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
  });

  await t.test('真實：倒數與口令、30 秒未決定自動棄牌、只閃金額', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'ante', 25);
    await h.waitBanner(page, 'No more bets');
    await h.waitBanner(page, 'Play or fold?');
    await h.waitCountdown(page);
    const n0 = await h.flashCount(page);
    const flash = await h.waitFlash(page, n0, 10000);
    h.assertEq(flash.net, -25, '逾時棄牌輸 Ante');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
  });

  await t.test('真實：跟注一局', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.placeChip(page, 'ante', 25);
    await page.waitForSelector('[data-action="play"]:not([hidden]):not([disabled])', { timeout: 8000 });
    const n0 = await h.flashCount(page);
    await page.click('[data-action="play"]');
    const flash = await h.waitFlash(page, n0);
    h.assertEq(await h.balance(page), 1000 + flash.net, '餘額');
  });
}
