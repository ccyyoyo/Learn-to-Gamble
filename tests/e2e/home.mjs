// 核心 e2e：首頁（四區 17 張卡、排行榜、變體資訊）、框架三模式（以骰寶 sicbo / 百家樂 baccarat 驗證）、
// 教學、真實倒數與口令、session 摘要、破產覆蓋層、持久化。
const ALL = ['baccarat', 'blackjack', 'roulette', 'sicbo', 'three-pictures', 'fantan',
  'caribbean-stud', 'three-card-poker', 'casino-holdem', 'ultimate-holdem', 'paigow-poker',
  'slot-classic', 'slot-video', 'slot-holdspin', 'slot-progressive', 'video-poker', 'poker-room'];

export default async function (t) {
  await t.test('首頁渲染：四區、17 張卡依規格順序、餘額、排行榜', async (page, h) => {
    await h.openHome(page);
    h.assertEq(await page.$$eval('.lg-cat', (e) => e.length), 4, '分類數');
    const cards = await page.$$eval('[data-game-card]', (e) => e.map((x) => x.dataset.gameCard));
    h.assertEq(cards.join(','), ALL.join(','), '卡片順序（00-common §1）');
    h.assertEq(await h.balance(page), 1000, '初始餘額');
    const edges = await page.$$eval('.lg-lb tbody tr[data-edge]', (rows) => rows.map((r) => Number(r.dataset.edge)));
    h.assertEq(edges.length, 16, '排行榜 16 列（撲克室另列）');
    h.assert(edges.every((v, i) => i === 0 || edges[i - 1] <= v), '排行榜由低到高');
    const last = await page.$eval('.lg-lb tbody tr:last-child', (r) => r.dataset.game + '|' + r.textContent);
    h.assert(last.startsWith('poker-room|') && last.includes('抽水 5%'), '撲克室在最下：' + last);
    const bac = await page.textContent('[data-game-card="baccarat"] .lg-gcard__variants');
    h.assert(bac.includes('免佣 1.46%') && bac.includes('傳統 1.06%'), '百家樂卡片變體資訊：' + bac);
    h.assert((await page.textContent('.lg-lb tr[data-game="baccarat"]')).includes('1.46%'), '排行榜百家樂變體資訊');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '首頁無橫向溢出 ' + w);
  });

  await t.test('三模式皆可進入（首頁卡片 → 練習、變體列、教學、真實進場）', async (page, h) => {
    await h.openHome(page);
    await page.click('[data-game-card="baccarat"] [data-mode="practice"]');
    await page.waitForSelector('.lg-game[data-game="baccarat"][data-mode="practice"][data-ready="1"]');
    h.assert(await page.$('.lg-switch[data-action="hints"]'), '練習模式有提示開關');
    h.assert(await page.$('.lg-variantbar [data-variant="squeeze"]'), '變體列');
    await h.openGame(page, 'sicbo', 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, 'sicbo', 'real');
    h.assert(await page.$('[data-action="real-start"]'), '真實模式進場 modal');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('20 秒'), '進場說明限注/倒數：' + txt);
    h.assert((await page.textContent('.lg-modebar__limits')).includes('限注 RM 25'), '模式列限注');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '遊戲頁無橫向溢出 ' + w);
  });

  await t.test('真實模式進場：不倒數（老虎機/視訊撲克）與 limitsLabel（撲克室）', async (page, h) => {
    await h.openGame(page, 'video-poker', 'real');
    let txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('不倒數') && !txt.includes('倒數 0 秒'), '視訊撲克不倒數：' + txt);
    await h.openGame(page, 'slot-holdspin', 'real');
    txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('不倒數') && !/倒數 \d+ 秒/.test(txt), 'Hold & Spin 不倒數：' + txt);
    await h.openGame(page, 'poker-room', 'real');
    txt = await page.textContent('.lg-modebar__limits');
    h.assertEq(txt, '買入 RM 400–1,000 · 盲注 RM 5/10', '撲克室模式列');
  });

  await t.test('練習模式玩一局 + 重整後餘額保留', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    await h.placeChip(page, 'big', 10);
    await h.placeChip(page, 'big', 10);
    h.assertEq(await h.betAmount(page, 'big'), 20, '下注 20');
    await h.removeChip(page, 'big');
    h.assertEq(await h.betAmount(page, 'big'), 10, '右鍵移除一枚');
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const bal = await h.balance(page);
    h.assert(bal === 1010 || bal === 990, '結算後餘額 ' + bal);
    const stats = await page.evaluate(() => LG.stats.get('sicbo'));
    h.assertEq(stats.rounds, 1, '練習記 stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局的發牌按鈕');
    await page.click('[data-action="rebet"]');
    h.assertEq(await h.betAmount(page, 'big'), 10, '重複上注');
    await page.reload();
    await page.waitForSelector('.lg-game[data-ready="1"]');
    h.assertEq(await h.balance(page), bal, '重整後餘額保留');
    h.assertEq(await page.evaluate(() => LG.stats.get('sicbo').rounds), 1, '重整後統計保留');
  });

  await t.test('練習：未下注發牌 / 餘額不足 / 提示開關', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    await h.deal(page);
    h.assert((await h.toastText(page)).includes('請先下注'), '未下注不能發牌');
    await h.setBalance(page, 15);
    await h.placeChip(page, 'small', 10);
    await h.placeChip(page, 'small', 10);
    h.assertEq(await h.betAmount(page, 'small'), 10, '不足時不加注');
    h.assert((await h.toastText(page)).includes('籌碼不足'), '籌碼不足 toast');
    const hintVisible = () => page.$eval('.sb-hint', (e) => !e.hidden);
    const before = await hintVisible();
    await page.click('[data-action="hints"]');
    h.assertEq(await hintVisible(), !before, '提示開關切換');
  });

  await t.test('教學：前 3 步可前進、有高亮；action 鎖住下一步；段落跳轉；完成', async (page, h) => {
    await h.openGame(page, 'sicbo', 'tutorial');
    await page.waitForSelector('.lg-tutor');
    h.assertEq((await h.tutorialStep(page)).index, 0, '第 1 步');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2, '第 3 步');
    await page.waitForSelector('[data-bet="odd"].lg-spot--hl');
    h.assert(await page.$('.lg-dimmed'), '其他區域變暗');
    while ((await h.tutorialStep(page)).id !== 'layout-chips') await h.tutorialNext(page);
    const idx = (await h.tutorialStep(page)).index;
    await page.click('[data-tutor="next"]', { force: true }); // aria-disabled：Playwright 需 force
    h.assertEq((await h.tutorialStep(page)).index, idx, 'action 未完成不能前進');
    await h.selectChip(page, 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).section, 'flow', '進入 flow 段');
    const pct = await page.evaluate(() => LG.progress.pct('sicbo'));
    h.assert(pct > 0, '進度寫入 ' + pct);
    await page.click('[data-tutor-section="strategy"]');
    h.assertEq((await h.tutorialStep(page)).section, 'strategy', '跳到策略段');
    while ((await page.getAttribute('[data-tutor="next"]', 'data-last')) !== '1') await h.tutorialNext(page);
    h.assert((await page.textContent('[data-tutor="next"]')).includes('去練習模式'), '最後一步按鈕');
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-game="sicbo"][data-mode="practice"][data-ready="1"]');
  });

  await t.test('教學模式用示範籌碼沙盒：真實餘額不足也能完成、不動真實餘額', async (page, h) => {
    await h.openHome(page);
    await h.setBalance(page, 5);
    await h.openGame(page, 'sicbo', 'tutorial');
    h.assertEq(await h.balance(page), 1000, '教學顯示示範籌碼 1000');
    h.assert(await page.$('.lg-topbar .lg-balance.is-sandbox'), '示範籌碼標記');
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'flow-place')); });
    await h.placeChip(page, 'big', 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page); // flow-shake
    await h.deal(page);
    await h.waitResult(page);
    const demo = await h.balance(page);
    h.assert(demo === 1050 || demo === 950, '示範籌碼結算 ' + demo);
    await page.click('.lg-topbar__back');
    await page.waitForSelector('.lg-page--home');
    h.assertEq(await h.balance(page), 5, '真實餘額不變');
    h.assertEq(await page.evaluate(() => LG.store.get().bank), 5, 'store 未被教學寫入');
  });

  await t.test('真實 → 練習：顯示 session 摘要', async (page, h) => {
    await h.openGame(page, 'sicbo', 'real');
    await h.startReal(page);
    await h.placeChip(page, 'small', 25);
    await h.waitFlash(page);
    await page.click('.lg-seg__btn[data-mode="practice"]');
    await page.waitForSelector('.lg-game[data-mode="practice"][data-ready="1"]');
    await page.waitForSelector('.lg-modal--summary');
    h.assertEq(await page.evaluate(() => LG.store.get().sessions.length), 1, 'session 寫入歷史');
  });

  await t.test('真實模式：倒數、口令（No more bets 停留）、只閃金額、離場摘要', async (page, h) => {
    await h.openGame(page, 'sicbo', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'big', 25);
    await h.waitBanner(page, 'No more bets');
    const flash = await h.waitFlash(page);
    h.assert(flash.net === 25 || flash.net === -25, '閃示金額 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    const sess = await page.evaluate(() => LG.stats.session.current());
    h.assertEq(sess.rounds, 1, 'session 記一局');
    await h.waitBanner(page, 'Place your bets');
    await page.click('.lg-topbar__back');
    await page.waitForSelector('.lg-modal--summary');
    h.assert((await page.textContent('.lg-modal--summary')).includes('局數'), 'session 摘要');
  });

  await t.test('荷官橫幅：No more bets 至少停留 600ms（×LG.speed）再被下一句蓋掉', async (page, h) => {
    await h.openGame(page, 'sicbo', 'practice');
    const r = await page.evaluate(async () => {
      LG.ui.dealer.say('停止下注', 'No more bets');
      LG.ui.dealer.say('發牌', 'Dealing');
      const first = document.querySelector('.lg-dealer-banner').dataset.en;
      await new Promise((res) => setTimeout(res, LG.ms(600) + 60));
      return { first, later: document.querySelector('.lg-dealer-banner').dataset.en };
    });
    h.assertEq(r.first, 'No more bets', '立即仍是 No more bets');
    h.assertEq(r.later, 'Dealing', '停留後換下一句');
  });

  await t.test('真實模式：破產覆蓋層（含自訂門檻）與重置', async (page, h) => {
    await h.openGame(page, 'sicbo', 'real');
    await h.startReal(page);
    await h.setBalance(page, 30);
    h.assertEq(await page.evaluate(() => LG.modes.ctx().checkBroke()), false, '30 ≥ 最低注 25');
    await page.evaluate(() => LG.modes.ctx().checkBroke(75));
    await page.waitForSelector('.lg-broke');
    h.assert((await page.textContent('.lg-broke')).includes('RM 75'), '覆蓋層顯示門檻');
    await page.click('.lg-broke [data-action="reset-bank"]');
    await page.waitForSelector('.lg-broke', { state: 'detached' });
    h.assertEq(await h.balance(page), 1000, '重置為 1000');
  });
}
