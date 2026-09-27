// Pai Gow Poker 牌九撲克 e2e：三模式、排牌（點牌切換 / Foul / 房規 / 重排 / 確認）、教學全程、真實倒數與排牌逾時
const ID = 'paigow-poker';

export default async function (t) {
  await t.test('三模式皆可進入、data-ready、下注格齊全、390px 不溢出', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    for (const spot of ['main', 'fortune']) h.assert(await page.$(`[data-bet="${spot}"]`), `下注格 ${spot}`);
    const txt = await page.textContent('[data-bet="fortune"]');
    h.assert(txt.includes('400') && txt.includes('Fortune Bonus'), 'Fortune 格含賠率：' + txt);
    h.assert(await page.$('.pg-dealer .pg-zone--high') && await page.$('.pg-player .pg-zone--low'), '高手/低手區');
    let w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '練習頁無橫向溢出 ' + w);
    await h.openGame(page, ID, 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, ID, 'real');
    const m = await page.textContent('.lg-modal');
    h.assert(m.includes('RM 50') && m.includes('3,000'), '真實限注說明：' + m);
    w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '真實頁無橫向溢出 ' + w);
  });

  await t.test('練習：下注 → 發牌 → 點牌切換 → Foul 擋住 → 房規排牌 → 確認 → 四段結果', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await page.evaluate(() => LG.rng.seed(123));
    // 只押 Fortune 不能發牌
    await h.placeChip(page, 'fortune', 10);
    await h.deal(page);
    h.assert((await h.toastText(page)).includes('主注'), '只押 Fortune 會被擋');
    await h.placeChip(page, 'main', 50);
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await page.waitForSelector('.pg-player.is-arranging');
    h.assertEq(await h.balance(page), 940, 'No more bets 後扣款');
    h.assertEq(await page.$$eval('.pg-player [data-card]', (e) => e.length), 7, '7 張');
    h.assert(await page.$eval('[data-action="set"]', (b) => b.disabled), '低手 0 張時確認 disabled');
    // 點牌 → 移到低手；再點 → 移回
    const first = await page.getAttribute('.pg-player .pg-zone--high [data-card]', 'data-card');
    await page.click(`.pg-player [data-card="${first}"]`);
    h.assertEq(await page.$$eval('.pg-player .pg-zone--low [data-card]', (e) => e.length), 1, '低手 1 張');
    await page.click(`.pg-player [data-card="${first}"]`);
    h.assertEq(await page.$$eval('.pg-player .pg-zone--low [data-card]', (e) => e.length), 0, '移回高手');
    // Foul：把對子（或最大兩張）放低
    await page.evaluate(() => LG.modes.instance().demo.foul());
    const foul = await page.$eval('.pg-status', (e) => ({ cls: e.className, text: e.textContent, color: getComputedStyle(e).backgroundColor }));
    h.assert(foul.cls.includes('pg-foul') && foul.text.includes('Foul'), 'Foul 紅字：' + JSON.stringify(foul));
    h.assert(await page.$eval('[data-action="set"]', (b) => b.disabled), 'Foul 時確認 disabled');
    // 重排
    await page.click('[data-action="reset"]');
    h.assertEq(await page.$$eval('.pg-player .pg-zone--low [data-card]', (e) => e.length), 0, '重排後低手清空');
    // 房規排牌：顯示套用規則
    await page.click('[data-action="houseway"]');
    h.assertEq(await page.$$eval('.pg-player .pg-zone--low [data-card]', (e) => e.length), 2, '房規：低手 2 張');
    h.assert((await page.textContent('.pg-hw-note')).includes('房規第'), '顯示套用的房規');
    h.assert(!(await page.$eval('[data-action="set"]', (b) => b.disabled)), '合法時可確認');
    await page.click('[data-action="set"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const hand = await page.textContent('.lg-result__v[data-k="hand"]');
    h.assert(hand.includes('高手') && hand.includes('低手') && hand.includes('莊') && hand.includes('Fortune'), '雙方高/低手牌型：' + hand);
    const formula = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(formula.includes('主注 RM 50') && formula.includes('Fortune RM 10') && formula.includes('淨'), '計算式：' + formula);
    h.assert((await page.textContent('.pg-dealer-note')).includes('莊家依房規第'), '莊家房規說明');
    h.assertEq(await page.$$eval('.pg-dealer .lg-card:not(.is-facedown)', (e) => e.length), 7, '莊家 7 張翻開');
    h.assertEq(await page.evaluate(() => LG.stats.get('paigow-poker').rounds), 1, '練習記 stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局的發牌按鈕');
  });

  await t.test('練習：提示開關顯示房規建議', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    const vis = () => page.$eval('.pg-hint', (e) => !e.hidden);
    const before = await vis();
    await page.click('[data-action="hints"]');
    h.assertEq(await vis(), !before, '提示切換');
    if (!(await vis())) await page.click('[data-action="hints"]');
    await h.placeChip(page, 'main', 50);
    await h.deal(page);
    await page.waitForSelector('.pg-player.is-arranging');
    h.assert((await page.textContent('.pg-hint')).includes('房規建議'), '排牌時提示房規建議');
    h.assert(await page.$('.lg-strategy:not([hidden]) table'), '房規表面板');
  });

  await t.test('教學：前 3 步高亮、action 鎖住、完整走完 → 練習', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-tutor');
    h.assertEq((await h.tutorialStep(page)).index, 0, '第 1 步');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.pg-dealer.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.pg-player.lg-spot--hl');
    h.assert(await page.$('.lg-dimmed'), '其他區域變暗');
    const total = await page.$$eval('.lg-tutor__count', (e) => Number(e[0].textContent.split('/')[1]));
    h.assert(total >= 14, '教學步數 ' + total);
    const seen = [];
    for (let guard = 0; guard < 60; guard++) {
      const s = await h.tutorialStep(page);
      seen.push(s.id);
      await page.waitForTimeout(40); // 等 requestAnimationFrame 後的高亮
      if (s.id === 'flow-place') {
        await page.click('[data-tutor="next"]', { force: true });
        h.assertEq((await h.tutorialStep(page)).id, 'flow-place', 'action 未完成不能前進');
        await h.placeChip(page, 'main', 50);
      }
      if (s.id === 'flow-deal') await h.deal(page);
      if (s.id === 'flow-foul') {
        await page.waitForSelector('.pg-status.pg-foul');
        h.assert(await page.$eval('[data-action="set"]', (b) => b.disabled), 'Foul 示範：確認 disabled');
      }
      if (s.id === 'flow-houseway') { await page.click('[data-action="houseway"]'); await page.waitForSelector('.pg-hw-note:not(:empty)'); }
      if (s.id === 'flow-set') { await page.click('[data-action="set"]'); await h.waitResult(page); await h.closeResult(page); }
      if (s.id === 'payout-joker-a') h.assert(await page.$('.pg-player .lg-card[data-rank="X"]'), '示範小丑牌');
      const last = (await page.getAttribute('[data-tutor="next"]', 'data-last')) === '1';
      if (s.id !== 'strategy-intro' && s.id !== 'strategy-edge') h.assert((await h.highlighted(page)) > 0, `第 ${s.index + 1} 步（${s.id}）有高亮`);
      if (last) break;
      await page.waitForFunction(() => { const a = document.querySelector('.lg-tutor__action'); return a && (a.hidden || a.classList.contains('is-done')); });
      await h.tutorialNext(page);
    }
    for (const id of ['flow-no-more-bets', 'flow-foul', 'payout-joker-b', 'payout-wheel', 'payout-copy', 'strategy-push', 'strategy-budget']) h.assert(seen.includes(id), '走過 ' + id);
    await page.click('[data-tutor="next"]');
    await page.waitForSelector(`.lg-game[data-game="${ID}"][data-mode="practice"][data-ready="1"]`);
  });

  await t.test('真實：倒數、口令、排牌逾時自動房規、只閃金額', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'main', 50);
    await h.waitBanner(page, 'Set your hand', 10000);
    await page.waitForSelector('.lg-countdown.is-active');
    h.assertEq(await h.balance(page), 950, '扣款');
    const since = await h.flashCount(page);
    const flash = await h.waitFlash(page, since, 15000);   // 60 秒 × LG_TEST 0.1
    h.assert([47.5, 0, -50].includes(flash.net), '閃示金額 ' + flash.net);
    h.assert((await h.toastText(page)).includes('逾時'), '逾時自動房規提示');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq(await page.evaluate(() => LG.stats.session.current().rounds), 1, 'session 記一局');
    await h.waitBanner(page, 'Place your bets', 10000);
  });

  await t.test('真實：手動房規排牌 + 確認', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.placeChip(page, 'main', 50);
    await page.waitForSelector('.pg-player.is-arranging', { timeout: 10000 });
    const since = await h.flashCount(page);
    await page.click('[data-action="houseway"]');
    await page.click('[data-action="set"]');
    const flash = await h.waitFlash(page, since, 6000);
    h.assert([47.5, 0, -50].includes(flash.net), '閃示金額 ' + flash.net);
    await page.click('.lg-topbar__back');
    await page.waitForSelector('.lg-modal--summary');
  });
}
