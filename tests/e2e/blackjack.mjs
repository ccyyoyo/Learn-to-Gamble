// 21 點 Blackjack e2e：三模式、練習一局、加倍/分牌/保險流程、餘額不足停用、提示、教學前 3 步與練習題、真實倒數與行動逾時
const rig = (page, cards) => page.evaluate((c) => LG.modes.instance().demo.rig(c), cards);
// 教學工作表固定在底部；捲到最底讓籌碼/動作列露出來（真實使用者也是這樣操作）
const scrollBottom = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && !e.closest('[hidden]')).catch(() => false);

export default async function (t) {
  await t.test('三模式皆可進入、桌面元素齊全、390px 不溢出', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    for (const sel of ['[data-bet="main"]', '[data-bet="insurance"]', '.bj-print', '.bj-insline', '.bj-shoe', '.bj-discard']) {
      h.assert(await page.$(sel), '缺少 ' + sel);
    }
    h.assertEq(await page.$$eval('.bj-seat', (e) => e.length), 5, '5 個座位');
    h.assertEq(await page.$$eval('.bj-seat--empty', (e) => e.length), 4, '其他 4 座空著');
    const txt = await page.textContent('.bj-table');
    h.assert(txt.includes('BLACKJACK PAYS 3 TO 2') && txt.includes('DEALER STANDS ON SOFT 17') && txt.includes('INSURANCE PAYS 2 TO 1'), '桌面印字');
    const spotTxt = await page.textContent('[data-bet="main"]');
    h.assert(spotTxt.includes('主注') && /bet/i.test(spotTxt) && spotTxt.includes('1:1'), '主注格中英賠率 ' + spotTxt);
    h.assertEq(await page.evaluate(() => document.documentElement.scrollWidth), 390, '無橫向溢出');
    await h.openGame(page, 'blackjack', 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, 'blackjack', 'real');
    const modal = await page.textContent('.lg-modal');
    h.assert(modal.includes('RM 50') && modal.includes('3,000') && modal.includes('15 秒'), '真實進場說明 ' + modal);
  });

  await t.test('練習：加倍流程（11 vs 6 → 20，莊爆）+ 結果四段', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    await rig(page, '5S 6D 6C KH 9S TD');
    await h.placeChip(page, 'main', 50);
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await page.waitForSelector('[data-action="double"]:not([hidden]):not([disabled])');
    h.assertEq(await h.balance(page), 950, '發牌後扣主注');
    await page.click('[data-action="double"]');
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('RM 100（RM 50 + 加倍 RM 50） × 1 = +RM 100'), '加倍算式 ' + f);
    h.assertEq(await h.balance(page), 1100, '加倍贏 RM 100');
    h.assertEq((await page.evaluate(() => LG.stats.get('blackjack'))).rounds, 1, '記 stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局發牌按鈕');
  });

  await t.test('練習：分牌流程（8,8 分成兩手，第二手注金另扣）', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    await rig(page, '8S 6D 8C TH 3S 2D 9H');
    await h.placeChip(page, 'main', 50);
    await h.deal(page);
    await page.waitForSelector('[data-action="split"]:not([hidden]):not([disabled])');
    await page.click('[data-action="split"]');
    await page.waitForSelector('[data-bet="main-2"]');
    h.assertEq(await h.betAmount(page, 'main-2'), 50, '第二手 RM 50');
    h.assertEq(await h.balance(page), 900, '分牌再扣 RM 50');
    h.assertEq(await page.$$eval('.bj-hand', (e) => e.length), 2, '兩手');
    await page.click('[data-action="stand"]');       // 第 1 手 8,3 停（偏離建議：加倍）
    await page.waitForSelector('.bj-hand.is-active[data-hand="1"]');
    await page.click('[data-action="stand"]');       // 第 2 手 8,2 停
    await h.waitResult(page);
    const why = await page.textContent('.lg-result__v[data-k="why"]');
    h.assert(why.includes('偏離') && why.includes('硬牌 11 vs 6'), '為什麼引用表格 ' + why);
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('第 1 手') && f.includes('第 2 手'), '每手算式 ' + f);
  });

  await t.test('練習：保險流程（莊明牌 A、買保險、莊 BJ → 淨 0）', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    await rig(page, 'TS AD 9C KH');
    await h.placeChip(page, 'main', 50);
    await h.deal(page);
    await h.waitBanner(page, 'Insurance?');
    await page.waitForSelector('[data-action="insure"]:not([hidden])');
    await page.click('[data-action="insure"]');
    await h.waitResult(page);
    h.assertEq(await h.balance(page), 1000, '保險 2:1 抵掉主注');
    const f = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(f.includes('保險 RM 25 × 2 = +RM 50'), '保險算式 ' + f);
    const why = await page.textContent('.lg-result__v[data-k="why"]');
    h.assert(why.includes('買了保險'), '偏離（買保險）提示 ' + why);
  });

  await t.test('練習：餘額不足 → 加倍/分牌停用並提示；提示開關顯示建議', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    await h.setBalance(page, 60);
    await rig(page, '8S 6D 8C TH');
    await h.placeChip(page, 'main', 50);
    await h.deal(page);
    await page.waitForSelector('[data-action="stand"]:not([hidden])');
    h.assert(await page.$eval('[data-action="double"]', (b) => b.disabled), '加倍停用');
    h.assert(await page.$eval('[data-action="split"]', (b) => b.disabled), '分牌停用');
    h.assert((await page.textContent('.bj-note')).includes('不足'), '提示餘額不足');
    // 提示：預設開 → 顯示建議；關掉 → 隱藏
    const on = await page.evaluate(() => !!LG.store.get().settings.hints);
    if (!on) await page.click('[data-action="hints"]');
    await page.waitForSelector('.bj-advice:not([hidden])');
    const adv = await page.textContent('.bj-advice');
    h.assert(adv.includes('建議：停牌 Stand（表：硬牌 16 vs 6）'), '建議文字（8,8 分不起 → 查硬 16）' + adv);
    h.assert(await page.$('.bj-strategy td.is-hl'), '策略表標出目前格子');
    await page.click('[data-action="hints"]');
    h.assert(!(await visible(page, '.bj-advice')), '關閉提示');
  });

  await t.test('局中離開（分牌後切模式）→ 退回已扣注金', async (page, h) => {
    await h.openGame(page, 'blackjack', 'practice');
    await rig(page, '8S 6D 8C TH 3S 2D');
    await h.placeChip(page, 'main', 50);
    await h.deal(page);
    await page.waitForSelector('[data-action="split"]:not([hidden]):not([disabled])');
    await page.click('[data-action="split"]');
    await page.waitForFunction(() => LG.bank.balance() === 900);
    await page.click('.lg-seg__btn[data-mode="tutorial"]');
    await page.waitForSelector('.lg-game[data-mode="tutorial"][data-ready="1"]');
    h.assertEq(await h.balance(page), 1000, '退回主注 + 分牌注');
  });

  await t.test('教學：前 3 步可前進有高亮；下注/發牌/加倍 action；練習題', async (page, h) => {
    await h.openGame(page, 'blackjack', 'tutorial');
    await page.waitForSelector('.lg-tutor');
    await page.waitForSelector('.bj-table.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.bj-print.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.bj-insline.lg-spot--hl');
    h.assertEq((await h.tutorialStep(page)).index, 2, '第 3 步');
    await page.click('[data-tutor-section="flow"]');
    await h.tutorialNext(page);                        // → flow-bet
    h.assertEq((await h.tutorialStep(page)).id, 'flow-bet');
    await page.click('[data-tutor="next"]', { force: true });
    h.assertEq((await h.tutorialStep(page)).id, 'flow-bet', 'action 未完成不能前進');
    await scrollBottom(page);
    await page.click('.lg-chips [data-denom="50"]');
    await page.click('[data-bet="main"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);                        // → flow-deal
    await scrollBottom(page);
    await page.click('[data-action="deal"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);                        // → flow-hole
    await h.tutorialNext(page);                        // → flow-signals
    await page.waitForSelector('[data-action="double"]:not([hidden])');
    await scrollBottom(page);
    await page.click('[data-action="hit"]');   // 教學限定加倍
    h.assert((await h.toastText(page)).includes('加倍'), '提示要按加倍');
    await page.click('[data-action="double"]');
    await h.waitResult(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.closeResult(page);
    // 策略段：練習題
    await page.click('[data-tutor-section="strategy"]');
    while ((await h.tutorialStep(page)).id !== 'strategy-quiz-1') await h.tutorialNext(page);
    await page.click('[data-bj-quiz="q1"][data-code="H"]');
    await page.waitForFunction(() => (document.querySelector('.lg-tutor__hint') || {}).textContent?.includes('不對'));   // 答錯提示
    await page.click('[data-bj-quiz="q1"][data-code="S"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    h.assert(await page.$('.lg-tutor .bj-quiz'), '練習題按鈕');
    const stepCount = await page.$eval('.lg-tutor__count', (e) => e.textContent);
    h.assert(Number(stepCount.split('/')[1]) >= 14, '步數 ' + stepCount);
  });

  await t.test('真實：倒數、口令、手勢按鈕、行動 20 秒逾時 = 停牌、只閃金額', async (page, h) => {
    await h.openGame(page, 'blackjack', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    await rig(page, 'TS 6D 7C 9H');                    // 你 17 vs 莊 6+9=15 → 補牌
    await h.placeChip(page, 'main', 50);
    // 'No more bets' 之後同一刻就換成 'Dealing'，所以直接等輪到你的口令
    await h.waitBanner(page, 'Hit or stand?');
    await page.waitForSelector('[data-action="hit"]:not([hidden])');
    const lbl = await page.textContent('[data-action="hit"]');
    h.assert(lbl.includes('指尖敲桌'), '手勢文字 ' + lbl);
    h.assert((await page.textContent('[data-action="stand"]')).includes('手掌橫掃'), '停牌手勢');
    await page.waitForSelector('.lg-countdown.is-active');   // 行動倒數
    const since = await h.flashCount(page);
    const flash = await h.waitFlash(page, since, 10000);     // 不操作 → 自動停牌 → 結算
    h.assert(typeof flash.net === 'number', '閃示金額');
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq((await page.evaluate(() => LG.stats.session.current())).rounds, 1, 'session 記一局');
  });

  await t.test('真實：保險詢問 5 秒逾時 = 不保', async (page, h) => {
    await h.openGame(page, 'blackjack', 'real');
    await h.startReal(page);
    await rig(page, 'TS AD 9C 7H');
    await h.placeChip(page, 'main', 50);
    await h.waitBanner(page, 'Insurance?');
    await page.waitForSelector('[data-action="insure"]:not([hidden])');
    h.assert((await page.textContent('[data-action="insure"]')).includes('半注放保險線'), '保險手勢');
    await page.waitForSelector('[data-action="hit"]:not([hidden])', { timeout: 8000 });   // 逾時不保 → 進入行動
    h.assertEq(await h.betAmount(page, 'insurance'), 0, '沒有保險注');
  });
}
