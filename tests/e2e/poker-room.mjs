// e2e：德州撲克現金桌 poker-room（docs/05-game-rules/poker-room.md §7、docs/07-test-plan.md §3）
const ID = 'poker-room';

/** 買入（LG_TEST 下動畫 ×0.1）；可選對手人數 */
async function buyIn(page, h, { opp = 3, amount } = {}) {
  await page.waitForSelector('[data-action="buyin"]');
  if (opp) { const b = await page.$(`[data-opp="${opp}"]`); if (b) await b.click(); }
  if (amount) await page.click(`[data-buyin="${amount}"]`);
  await page.click('[data-action="buyin"]');
  await page.waitForSelector('.pr-seat--you');
}

/** 確保練習模式提示開關為開 */
async function hintsOn(page) {
  if ((await page.getAttribute('[data-action="hints"]', 'aria-checked')) !== 'true') await page.click('[data-action="hints"]');
}

/** 輪到你就按「過牌/跟注」，直到 done() 為真 */
async function playUntil(page, done, { maxMs = 25000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await done()) return true;
    const btn = await page.$('[data-action="call"]:not([disabled]):not([hidden])');
    if (btn) await btn.click().catch(() => {});
    await page.waitForTimeout(80);
  }
  throw new Error('playUntil timeout');
}

export default async function (t) {
  await t.test('三模式皆可進入且 data-ready', async (page, h) => {
    for (const m of ['tutorial', 'practice', 'real']) {
      await h.openGame(page, ID, m);
      h.assert(await page.$('.pr-oval'), `${m}: 沒有橢圓桌`);
    }
  });

  await t.test('練習：買入 → 玩一手到結束（結果面板四段）→ 離桌轉回餘額', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await buyIn(page, h, { opp: 3, amount: 600 });
    h.assertEq(await h.balance(page), 400, '買入 RM 600 後餘額');
    h.assertEq(await page.$$eval('.pr-seat', (x) => x.length), 4, '座位數（你 + 3 AI）');
    // 手機寬不溢出
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(sw <= 392, `橫向溢出 scrollWidth=${sw}`);
    await hintsOn(page);
    await h.deal(page);
    await playUntil(page, async () => !!(await page.$('.lg-result')) || !!(await page.$('.pr-hint:not([hidden])')));
    await playUntil(page, async () => !!(await page.$('.lg-result')));
    const keys = await page.$$eval('.lg-result [data-k]', (els) => els.map((e) => e.dataset.k));
    for (const k of ['hand', 'result', 'formula', 'why']) h.assert(keys.includes(k), `結果面板缺 ${k}`);
    const formula = await page.$eval('.lg-result [data-k="formula"]', (e) => e.textContent);
    h.assert(/抽水|No flop/.test(formula), '賠付段沒有抽水說明');
    h.assert(await page.$eval('.pr-history', (e) => e.querySelectorAll('.pr-hh').length) >= 1, '手牌歷程沒有紀錄');
    const stack = await page.evaluate(() => LG.modes.instance().table().seats[0].stack);
    await page.click('.lg-result [data-action="result-close"]');
    await page.click('[data-action="leave-table"]');
    await page.waitForSelector('.lg-page--home');
    h.assertEq(await h.balance(page), 400 + stack, '離桌後籌碼轉回餘額');
    const s = await page.evaluate(() => LG.stats.get('poker-room'));
    h.assertEq(s.rounds, 1, '練習統計手數');
  });

  await t.test('練習：顯示勝率提示（Monte Carlo）與建議', async (page, h) => {
    await h.openGame(page, ID, 'practice');
    await buyIn(page, h, { opp: 3 });
    await hintsOn(page);
    await h.deal(page);
    // 輪到你時出現提示（這手若在你行動前就結束，再發一手）
    const t0 = Date.now();
    while (!(await page.$('.pr-hint:not([hidden])'))) {
      h.assert(Date.now() - t0 < 20000, '提示沒出現');
      const r = await page.$('.lg-result [data-action="result-next"]');
      if (r) await r.click();
      await page.waitForTimeout(100);
    }
    const txt = await page.$eval('.pr-hint', (e) => e.textContent);
    h.assert(/勝率/.test(txt) && /底池賠率/.test(txt) && /建議/.test(txt), '提示內容不完整：' + txt);
  });

  await t.test('教學：前 3 步可前進且 highlight 存在；發牌 action 可完成', async (page, h) => {
    await h.openGame(page, ID, 'tutorial');
    await page.waitForSelector('.lg-tutor');
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction(() => document.querySelectorAll('.lg-spot--hl').length > 0);
      await h.tutorialNext(page);
    }
    h.assertEq((await h.tutorialStep(page)).id, 'layout-blinds');
    await page.waitForFunction(() => document.querySelectorAll('.lg-spot--hl').length > 0);
    await page.click('[data-tutor-section="flow"]');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-deal');
    h.assertEq(await page.getAttribute('[data-tutor="next"]', 'aria-disabled'), 'true', 'action 前應鎖住');
    // 發牌鈕在教學工作表下方（需捲動）；直接觸發 DOM click
    await page.$eval('[data-action="deal"]', (b) => b.click());
    await page.waitForFunction(() => !document.querySelector('[data-tutor="next"]').hasAttribute('aria-disabled'));
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'flow-order');
    // 教學籌碼不動到餘額
    h.assertEq(await h.balance(page), 1000, '教學不扣餘額');
  });

  await t.test('真實：買入 → 30 秒行動倒數與口令 → 一手結束只閃金額 → 離桌顯示 session 摘要', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await buyIn(page, h, { opp: 3 });
    h.assertEq(await h.balance(page), 0, '買入 RM 1,000');
    // 等到輪到你（倒數出現）
    await page.waitForSelector('.lg-countdown.is-active', { timeout: 30000 });
    const rem = Number(await page.getAttribute('.lg-countdown', 'data-remaining'));
    h.assert(rem >= 25 && rem <= 30, `倒數秒數 ${rem}`);
    const b = await h.banner(page);
    h.assert(b.en === 'Your action' || b.en.length > 0, '沒有荷官口令');
    h.assert(!(await page.$('.pr-hint:not([hidden])')), '真實模式不應有提示');
    const since = await h.flashCount(page);
    await playUntil(page, async () => (await h.flashCount(page)) > since);
    h.assert(!(await page.$('.lg-result')), '真實模式不應有結果面板');
    await page.click('[data-action="leave-table"]');
    await page.waitForSelector('.lg-modal--summary, .lg-modal [data-action="ok"]');
    const ok = await page.$('.lg-modal [data-action="ok"]');
    if (ok) await ok.click();                      // 局中離桌 = 棄牌（確認）
    await page.waitForSelector('.lg-modal--summary', { timeout: 8000 });
    const txt = await page.$eval('.lg-modal--summary', (e) => e.textContent);
    h.assert(/局數/.test(txt) && /淨輸贏/.test(txt), 'session 摘要內容');
    const sess = await page.evaluate(() => LG.store.get().sessions.slice(-1)[0]);
    h.assert(sess && sess.gameId === 'poker-room' && sess.rounds >= 1, 'session 手數');
    h.assert((await h.balance(page)) > 0 || sess.net <= -1000, '離桌後桌上籌碼轉回餘額');
  });

  await t.test('真實：逾時自動過牌/棄牌', async (page, h) => {
    await h.openGame(page, ID, 'real');
    await h.startReal(page);
    await buyIn(page, h, { opp: 3 });
    await page.waitForSelector('.lg-countdown.is-active', { timeout: 30000 });
    // LG_TEST：30 秒 × 0.1 = 3 秒 → 自動過牌 / 棄牌
    await page.waitForFunction(() => LG.modes.instance().state.timeouts > 0, null, { timeout: 8000 });
    const last = await page.evaluate(() => LG.modes.instance().table().log.filter((l) => l.seat === 0 && l.type).map((l) => l.type));
    h.assert(last.includes('fold') || last.includes('check'), '逾時動作：' + last.join(','));
  });
}
