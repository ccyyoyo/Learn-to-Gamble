// 核心 e2e：首頁、示範遊戲 _demo 三模式、教學、真實倒數、持久化。
export default async function (t) {
  await t.test('首頁渲染：四區、示範卡、餘額、排行榜', async (page, h) => {
    await h.openHome(page);
    h.assertEq(await page.$$eval('.lg-cat', (e) => e.length), 4, '分類數');
    h.assert(await page.$('[data-game-card="_demo"]'), '示範遊戲卡片');
    h.assertEq(await h.balance(page), 1000, '初始餘額');
    const edges = await page.$$eval('.lg-lb tbody tr[data-edge]', (rows) => rows.map((r) => Number(r.dataset.edge)));
    h.assert(edges.length >= 1, '排行榜至少一列');
    h.assert(edges.every((v, i) => i === 0 || edges[i - 1] <= v), '排行榜由低到高');
    const last = await page.$eval('.lg-lb tbody tr:last-child', (r) => r.dataset.game + '|' + r.textContent);
    h.assert(last.startsWith('poker-room|') && last.includes('抽水 5%'), '撲克室在最下：' + last);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '首頁無橫向溢出 ' + w);
  });

  await t.test('_demo 三模式皆可進入', async (page, h) => {
    await h.openHome(page);
    await page.click('[data-game-card="_demo"] [data-mode="practice"]');
    await page.waitForSelector('.lg-game[data-game="_demo"][data-mode="practice"][data-ready="1"]');
    h.assert(await page.$('.lg-switch[data-action="hints"]'), '練習模式有提示開關');
    h.assert(await page.$('.lg-variantbar [data-variant="squeeze"]'), '變體列');
    await h.openGame(page, '_demo', 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, '_demo', 'real');
    h.assert(await page.$('[data-action="real-start"]'), '真實模式進場 modal');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('10 秒'), '進場說明限注/倒數：' + txt);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '遊戲頁無橫向溢出 ' + w);
  });

  await t.test('練習模式玩一局 + 重整後餘額保留', async (page, h) => {
    await h.openGame(page, '_demo', 'practice');
    await h.placeChip(page, 'hi', 10);
    await h.placeChip(page, 'hi', 10);
    h.assertEq(await h.betAmount(page, 'hi'), 20, '下注 20');
    await h.removeChip(page, 'hi');
    h.assertEq(await h.betAmount(page, 'hi'), 10, '右鍵移除一枚');
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const bal = await h.balance(page);
    h.assert(bal === 1008 || bal === 990, '結算後餘額 ' + bal);
    const stats = await page.evaluate(() => LG.stats.get('_demo'));
    h.assertEq(stats.rounds, 1, '練習記 stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局的發牌按鈕');
    // 重複上注
    await page.click('[data-action="rebet"]');
    h.assertEq(await h.betAmount(page, 'hi'), 10, '重複上注');
    await page.reload();
    await page.waitForSelector('.lg-game[data-ready="1"]');
    h.assertEq(await h.balance(page), bal, '重整後餘額保留');
    h.assertEq(await page.evaluate(() => LG.stats.get('_demo').rounds), 1, '重整後統計保留');
  });

  await t.test('練習：餘額不足 / 未下注發牌 / 提示開關', async (page, h) => {
    await h.openGame(page, '_demo', 'practice');
    await h.deal(page);
    h.assert((await h.toastText(page)).includes('請先下注'), '未下注不能發牌');
    await h.setBalance(page, 15);
    await h.placeChip(page, 'lo', 10);
    await h.placeChip(page, 'lo', 10);
    h.assertEq(await h.betAmount(page, 'lo'), 10, '不足時不加注');
    h.assert((await h.toastText(page)).includes('籌碼不足'), '籌碼不足 toast');
    const hintVisible = () => page.$eval('.demo-hint', (e) => !e.hidden);
    const before = await hintVisible();
    await page.click('[data-action="hints"]');
    h.assertEq(await hintVisible(), !before, '提示開關切換');
  });

  await t.test('咪牌變體：拖曳掀牌後結算', async (page, h) => {
    await h.openGame(page, '_demo', 'practice', 'squeeze');
    await h.placeChip(page, 'lo', 25);
    await h.deal(page);
    await page.waitForSelector('.lg-card.is-squeeze');
    h.assert(!(await page.$('.lg-result')), '掀牌前不結算');
    await h.dragSqueeze(page);
    await h.waitResult(page);
  });

  await t.test('教學：前 3 步可前進、有高亮；action 鎖住下一步', async (page, h) => {
    await h.openGame(page, '_demo', 'tutorial');
    await page.waitForSelector('.lg-tutor');
    h.assertEq((await h.tutorialStep(page)).index, 0, '第 1 步');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    const s = await h.tutorialStep(page);
    h.assertEq(s.index, 2, '第 3 步');
    await page.waitForSelector('[data-bet="lo"].lg-spot--hl');
    h.assert(await page.$('.lg-dimmed'), '其他區域變暗');
    await h.tutorialNext(page); // → 第 4 步（action：選 25）
    h.assertEq((await h.tutorialStep(page)).id, 'layout-chips');
    await page.click('[data-tutor="next"]', { force: true }); // aria-disabled：Playwright 需 force
    h.assertEq((await h.tutorialStep(page)).index, 3, 'action 未完成不能前進');
    await h.selectChip(page, 25);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).section, 'flow', '進入 flow 段');
    const pct = await page.evaluate(() => LG.progress.pct('_demo'));
    h.assert(pct > 0, '進度寫入 ' + pct);
    // 段落跳轉
    await page.click('[data-tutor-section="strategy"]');
    h.assertEq((await h.tutorialStep(page)).section, 'strategy', '跳到策略段');
    // 最後一步 →「完成！去練習模式」
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') await h.tutorialNext(page);
    h.assert((await page.textContent('[data-tutor="next"]')).includes('去練習模式'), '最後一步按鈕');
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-game="_demo"][data-mode="practice"][data-ready="1"]');
  });

  await t.test('真實 → 練習：顯示 session 摘要', async (page, h) => {
    await h.openGame(page, '_demo', 'real');
    await h.startReal(page);
    await h.placeChip(page, 'lo', 25);
    await h.waitFlash(page);
    await page.click('.lg-seg__btn[data-mode="practice"]');
    await page.waitForSelector('.lg-game[data-mode="practice"][data-ready="1"]');
    await page.waitForSelector('.lg-modal--summary');
    h.assertEq(await page.evaluate(() => LG.store.get().sessions.length), 1, 'session 寫入歷史');
  });

  await t.test('真實模式：倒數、口令、只閃金額、離場摘要', async (page, h) => {
    await h.openGame(page, '_demo', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'hi', 25);
    await h.waitBanner(page, 'No more bets');
    const flash = await h.waitFlash(page);
    h.assert(flash.net === 20 || flash.net === -25, '閃示金額 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    const sess = await page.evaluate(() => LG.stats.session.current());
    h.assertEq(sess.rounds, 1, 'session 記一局');
    // 自動下一局：再次出現倒數
    await h.waitBanner(page, 'Place your bets');
    await page.click('.lg-topbar__back');
    await page.waitForSelector('.lg-modal--summary');
    h.assert((await page.textContent('.lg-modal--summary')).includes('局數'), 'session 摘要');
  });

  await t.test('真實模式：破產覆蓋層與重置', async (page, h) => {
    await h.openGame(page, '_demo', 'real');
    await h.startReal(page);
    await h.setBalance(page, 20);
    await page.evaluate(() => LG.modes.ctx().checkBroke());
    await page.waitForSelector('.lg-broke');
    await page.click('.lg-broke [data-action="reset-bank"]');
    await page.waitForSelector('.lg-broke', { state: 'detached' });
    h.assertEq(await h.balance(page), 1000, '重置為 1000');
  });
}
