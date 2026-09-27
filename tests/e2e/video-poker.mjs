// 視訊撲克 e2e（LG_TEST：動畫 ×0.1）：三模式進入、練習玩一手（DEAL → HOLD → DRAW → 結果四段）、
// 提示、教學前幾步與 action 鎖、真實模式（不倒數、只閃金額、session、破產覆蓋層）。
const ID = 'video-poker';

async function waitHold(page) {
  await page.waitForSelector('.vp-slot:not([disabled])');
  await page.waitForSelector('[data-action="draw"]:not([hidden]):not([disabled])');
}

export default async function (t) {
  await t.test('三模式皆可進入、390px 不溢出', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    h.assert(await page.$('.lg-switch[data-action="hints"]'), '練習模式有提示開關');
    h.assertEq(await page.$$eval('.vp-paytable tr[data-hand]', (r) => r.length), 9, '賠付表 9 列');
    h.assertEq(await page.$$eval('.vp-paytable th[data-col]', (r) => r.length), 5, '賠付表 5 欄');
    h.assertEq(await page.$eval('.vp-paytable tr[data-hand="royal"] td[data-col="5"]', (e) => e.textContent), '4000', '皇家 5 枚 4000');
    h.assert(!(await page.$('.lg-chips')), '不用籌碼盤');
    let w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '練習頁無橫向溢出 ' + w);
    await h.openGame(page, ID, 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, ID, 'real');
    h.assert(await page.$('[data-action="real-start"]'), '真實模式進場 modal');
    w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '真實頁無橫向溢出 ' + w);
  });

  await t.test('練習：BET ONE / 每枚金額，玩一手 DEAL → HOLD → DRAW', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    h.assertEq(await page.$eval('.vp-meter--bet .vp-meter__v', (e) => e.dataset.coins), '5', '預設 5 枚');
    await page.click('[data-action="bet-one"]');
    h.assertEq(await page.$eval('.vp-meter--bet .vp-meter__v', (e) => e.dataset.coins), '1', 'BET ONE 5→1');
    h.assertEq(await page.$eval('.vp-paytable th.is-col', (e) => e.dataset.col), '1', '目前枚數欄高亮');
    await page.click('[data-action="bet-one"]');
    await page.click('[data-coin="0.5"]');
    h.assert(await page.$('[data-coin="0.5"].is-active'), '每枚 RM 0.50');
    h.assertEq(await h.balance(page), 1000, '按 DEAL 前不扣款');
    await h.deal(page);
    await waitHold(page);
    h.assertEq(await h.balance(page), 999, 'DEAL 扣 2 枚 × RM 0.50');
    h.assertEq(await page.$$eval('.vp-cards .lg-card:not(.is-facedown)', (e) => e.length), 5, '5 張牌翻開');
    await page.click('.vp-slot[data-slot="0"]');
    await page.click('.vp-slot[data-slot="2"]');
    h.assertEq(await page.$$eval('.vp-slot.is-held', (e) => e.length), 2, 'HELD 兩張');
    await page.click('.vp-slot[data-slot="2"]');
    h.assertEq(await page.$$eval('.vp-slot.is-held', (e) => e.length), 1, '再點取消 HOLD');
    const keep = await page.$eval('.vp-slot[data-slot="0"] .lg-card', (e) => e.dataset.id);
    await page.click('[data-action="draw"]');
    await h.waitResult(page);
    h.assertEq(await page.$eval('.vp-slot[data-slot="0"] .lg-card', (e) => e.dataset.id), keep, '留的牌不變');
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const why = await page.$eval('.lg-result__v[data-k="why"]', (e) => e.textContent);
    h.assert(why.includes('你留') && (why.includes('建議') || why.includes('策略表一樣')), 'why 比較你留的與建議：' + why);
    const formula = await page.$eval('.lg-result__v[data-k="formula"]', (e) => e.textContent);
    h.assert(formula.includes('押注 2 枚 × RM 0.50 = RM 1'), '賠付計算式：' + formula);
    const bal = await h.balance(page);
    h.assert(bal >= 999, '結算後餘額 ' + bal);
    h.assertEq(await page.evaluate(() => LG.stats.get('video-poker').rounds), 1, '練習記 stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]:not([hidden])'), '可以再 DEAL');
  });

  await t.test('練習：提示顯示建議留牌', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    const on = await page.$eval('.lg-switch[data-action="hints"]', (e) => e.getAttribute('aria-checked') === 'true');
    if (!on) await page.click('[data-action="hints"]');
    await h.deal(page);
    await waitHold(page);
    const txt = await page.$eval('.vp-hint', (e) => (e.hidden ? '' : e.textContent));
    h.assert(/建議(留 .+（.+）|全部換掉)/.test(txt), '提示文字：' + txt);
    await page.click('[data-action="hints"]');
    h.assert(await page.$eval('.vp-hint', (e) => e.hidden), '關閉提示後隱藏');
  });

  await t.test('教學：前 3 步可前進、有高亮；BET ONE action 鎖住下一步', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-tutor');
    h.assertEq((await h.tutorialStep(page)).index, 0, '第 1 步');
    await page.waitForSelector('.vp-machine.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.vp-paytable.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('tr[data-hand="royal"].lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'layout-coins');
    await page.click('[data-tutor="next"]', { force: true });
    h.assertEq((await h.tutorialStep(page)).index, 3, 'action 未完成不能前進');
    await page.click('[data-action="bet-one"]');
    await page.click('[data-action="bet-one"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'layout-hold');
    await page.click('.vp-slot[data-slot="0"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).section, 'flow', '進入 flow 段');
    // 流程：DEAL（固定牌 J♥ J♦…）→ 留兩張 J → DRAW
    await h.tutorialNext(page);
    await h.deal(page);
    await waitHold(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await page.click('.vp-slot[data-slot="0"]');
    await page.click('.vp-slot[data-slot="1"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    await page.click('[data-action="draw"]');
    await h.waitResult(page);
    h.assert((await page.$eval('.lg-result__v[data-k="result"]', (e) => e.textContent)).includes('三條'), '示範手換到三條 J');
    await page.waitForSelector('.lg-tutor__action.is-done');
    h.assertEq(await h.balance(page), 1000, '教學不扣款');
    // 互動題 1：拆 KK 留 10 J Q K
    await h.closeResult(page);
    await page.click('[data-tutor-section="strategy"]');
    while ((await h.tutorialStep(page)).id !== 'strategy-q1') await h.tutorialNext(page);
    await page.click('.vp-slot[data-slot="3"]');
    await page.click('.vp-slot[data-slot="4"]');
    await page.waitForTimeout(300);
    h.assert(!(await page.$('.lg-tutor__action.is-done')), '留 KK 不對');
    await page.click('.vp-slot[data-slot="4"]');
    for (const i of [0, 1, 2]) await page.click(`.vp-slot[data-slot="${i}"]`);
    await page.waitForSelector('.lg-tutor__action.is-done');
  });

  await t.test('真實模式：不倒數、口令、只閃金額、session', async (page, h) => {
    await h.openGame(page, ID, 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 0.20') && txt.includes('不倒數'), '進場說明限注／不倒數：' + txt);
    await h.startReal(page);
    h.assert(!(await page.$('.lg-countdown.is-active')), '不倒數');
    await h.deal(page);
    await h.waitBanner(page, 'Dealing');
    await waitHold(page);
    h.assertEq(await h.balance(page), 995, 'DEAL 扣 5 枚 × RM 1');
    const since = await h.flashCount(page);
    await page.click('[data-action="draw"]');
    const flash = await h.waitFlash(page, since);
    h.assert(typeof flash.net === 'number', '閃示金額 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    const sess = await page.evaluate(() => LG.stats.session.current());
    h.assertEq(sess.rounds, 1, 'session 記一局');
    h.assert(await page.$('[data-action="deal"]:not([hidden]):not([disabled])'), '可再 DEAL');
  });

  await t.test('真實模式：餘額不足 → 破產覆蓋層', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await h.setBalance(page, 0.1);
    await h.deal(page);
    await page.waitForSelector('.lg-broke');
    await page.click('.lg-broke [data-action="reset-bank"]');
    await page.waitForSelector('.lg-broke', { state: 'detached' });
    h.assertEq(await h.balance(page), 1000, '重置為 1000');
  });
}
