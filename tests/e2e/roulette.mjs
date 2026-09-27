// 輪盤 Roulette e2e：三模式、熱區幾何（直式/橫式）、5 內注 + 3 外注結算、提示、教學 action、真實倒數/口令/限注。
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// 獨立於遊戲程式的號碼集合與賠率
const EXPECT = {
  'n-17': [[17], 35],
  'split-17-20': [[17, 20], 17],
  'street-16': [[16, 17, 18], 11],
  'corner-17': [[17, 18, 20, 21], 8],
  'line-16': [range(16, 21), 5],
  red: [RED, 1],
  'dozen-2': [range(13, 24), 2],
  'col-2': [range(1, 36).filter((n) => n % 3 === 2), 2],
};

async function center(page, sel) {
  const b = await (await page.$(sel)).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, left: b.x, top: b.y, bottom: b.y + b.height };
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

export default async function (t) {
  await t.test('三模式皆可進入、157 個下注格、390px 不溢出', async (page, h) => {
    await h.openGame(page, 'roulette', 'practice');
    h.assertEq(await page.$$eval('.rl-table [data-bet]', (e) => e.length), 157, 'data-bet 數量');
    h.assert(await page.$('.rl-wheel .rl-pocket'), 'SVG 輪盤');
    h.assertEq(await page.$$eval('.rl-pocket', (e) => e.length), 37, '37 格');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, '練習頁無橫向溢出 ' + w);
    const minHs = await page.$$eval('.rl-hs', (els) => Math.min(...els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))));
    h.assert(minHs >= 22, '熱區 ≥ 22px：' + minHs);
    await h.openGame(page, 'roulette', 'tutorial');
    h.assert(await page.$('.lg-tutor'), '教學工作表');
    await h.openGame(page, 'roulette', 'real');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 25') && txt.includes('20 秒'), '進場說明：' + txt);
  });

  await t.test('熱區幾何：直式（手機）與橫式（桌機）', async (page, h) => {
    await h.openGame(page, 'roulette', 'practice');
    const c = {};
    for (const s of ['n-16', 'n-17', 'n-18', 'n-19', 'n-20', 'n-21', 'n-1', 'n-2', 'n-3', 'n-0', 'split-17-20', 'split-17-18', 'corner-17', 'street-16', 'line-16', 'trio-0-1-2', 'corner-0', 'split-0-2']) c[s] = await center(page, `[data-bet="${s}"]`);
    // 直式：1-2-3 同一排由左到右，17 在 20 上方，0 在最上
    h.assert(near(c['n-1'].y, c['n-3'].y) && c['n-1'].x < c['n-2'].x && c['n-2'].x < c['n-3'].x, '直式 1-2-3 同排');
    h.assert(c['n-17'].y < c['n-20'].y && near(c['n-17'].x, c['n-20'].x), '直式 17 在 20 上方');
    h.assert(c['n-0'].y < c['n-1'].y, '0 在頂端');
    h.assert(near(c['split-17-20'].x, c['n-17'].x) && near(c['split-17-20'].y, (c['n-17'].y + c['n-20'].y) / 2), '分注 17-20 在兩號中間');
    h.assert(near(c['split-17-18'].y, c['n-17'].y) && near(c['split-17-18'].x, (c['n-17'].x + c['n-18'].x) / 2), '分注 17-18');
    const cx = (c['n-17'].x + c['n-18'].x + c['n-20'].x + c['n-21'].x) / 4, cy = (c['n-17'].y + c['n-18'].y + c['n-20'].y + c['n-21'].y) / 4;
    h.assert(near(c['corner-17'].x, cx) && near(c['corner-17'].y, cy), '角注 17 在四號交叉點');
    h.assert(near(c['street-16'].y, c['n-16'].y) && near(c['street-16'].x, c['n-16'].left), '街注 16 在排外側端線');
    h.assert(near(c['line-16'].y, (c['n-16'].y + c['n-19'].y) / 2) && near(c['line-16'].x, c['n-16'].left), '線注 16 在兩排交界');
    h.assert(near(c['trio-0-1-2'].x, (c['n-1'].x + c['n-2'].x) / 2) && near(c['trio-0-1-2'].y, c['n-1'].top), '三數 0-1-2');
    h.assert(near(c['corner-0'].x, c['n-1'].left) && near(c['corner-0'].y, c['n-1'].top), '首四在 0 下緣外側角');
    h.assert(near(c['split-0-2'].x, c['n-2'].x), '分注 0-2');
    // 橫式
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(50);
    const d = {};
    for (const s of ['n-1', 'n-2', 'n-3', 'n-4', 'n-0', 'split-1-2', 'split-1-4', 'street-1', 'corner-1', 'col-3', 'dozen-1']) d[s] = await center(page, `[data-bet="${s}"]`);
    h.assert(d['n-3'].y < d['n-2'].y && d['n-2'].y < d['n-1'].y && near(d['n-1'].x, d['n-3'].x), '橫式 3 在上、1 在下');
    h.assert(d['n-4'].x > d['n-1'].x && near(d['n-4'].y, d['n-1'].y), '橫式 4 在 1 右邊');
    h.assert(d['n-0'].x < d['n-1'].x, '橫式 0 在左');
    h.assert(d['col-3'].x > d['n-4'].x && near(d['col-3'].y, d['n-3'].y), '2to1 在右端');
    h.assert(d['dozen-1'].y > d['n-1'].y, '打在下方');
    h.assert(near(d['split-1-2'].x, d['n-1'].x) && near(d['split-1-2'].y, (d['n-1'].y + d['n-2'].y) / 2), '橫式分注 1-2');
    h.assert(near(d['split-1-4'].y, d['n-1'].y) && near(d['split-1-4'].x, (d['n-1'].x + d['n-4'].x) / 2), '橫式分注 1-4');
    h.assert(near(d['street-1'].x, d['n-1'].x) && near(d['street-1'].y, d['n-1'].bottom), '橫式街注在下緣');
    h.assert(near(d['corner-1'].x, (d['n-1'].x + d['n-4'].x) / 2) && near(d['corner-1'].y, (d['n-1'].y + d['n-2'].y) / 2), '橫式角注');
  });

  await t.test('練習：5 種內注 + 3 種外注開獎，總結算正確', async (page, h) => {
    await h.openGame(page, 'roulette', 'practice');
    await h.selectChip(page, 10);
    for (const s of ['n-17', 'split-17-20', 'street-16', 'corner-17', 'line-16']) await h.placeChip(page, s);
    await h.selectChip(page, 25);
    for (const s of ['red', 'dozen-2', 'col-2']) await h.placeChip(page, s);
    const stakeOf = (s) => (['red', 'dozen-2', 'col-2'].includes(s) ? 25 : 10);
    for (const s of Object.keys(EXPECT)) h.assertEq(await h.betAmount(page, s), stakeOf(s), s);
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await h.waitResult(page);
    const n = Number(await page.getAttribute('.rl-last', 'data-n'));
    h.assert(n >= 0 && n <= 36, '開出號碼 ' + n);
    let net = 0;
    for (const [s, [nums, odds]] of Object.entries(EXPECT)) {
      const stake = stakeOf(s);
      net += nums.includes(n) ? stake * odds : -stake;
    }
    h.assertEq(await h.balance(page), 1000 + net, `開 ${n} 結算`);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '結果面板四段');
    const formula = await page.textContent('.lg-result__v[data-k="formula"]');
    h.assert(formula.includes('直注 17') && formula.includes('紅'), '計算式列出每注：' + formula);
    h.assert(await page.$(`[data-bet="n-${n}"] .rl-dolly`), 'dolly 在開出號碼上');
    h.assertEq(await page.$$eval('.rl-hist', (e) => e.length), 1, '最近號碼列');
    h.assertEq(await page.evaluate(() => LG.stats.get('roulette').rounds), 1, '練習記 stats');
    await h.closeResult(page);
    await page.waitForSelector('[data-action="deal"]');
    await page.click('[data-action="rebet"]');
    h.assertEq(await h.betAmount(page, 'corner-17'), 10, '重複上注');
  });

  await t.test('練習：提示開關顯示賠率與命中機率', async (page, h) => {
    await h.openGame(page, 'roulette', 'practice');
    await h.placeChip(page, 'split-0-1', 10);
    const on = await page.$eval('.rl-hint', (e) => !e.hidden);
    if (!on) await page.click('[data-action="hints"]');
    await page.waitForSelector('.rl-hint:not([hidden])');
    const txt = await page.textContent('.rl-hint');
    h.assert(txt.includes('17:1') && txt.includes('2/37'), '提示內容：' + txt);
    await page.click('[data-action="hints"]');
    h.assert(await page.$eval('.rl-hint', (e) => e.hidden), '關閉提示');
  });

  await t.test('教學：前 3 步可前進；直注 action 放一枚後解鎖', async (page, h) => {
    await h.openGame(page, 'roulette', 'tutorial');
    await page.waitForSelector('.lg-tutor');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await page.waitForSelector('.rl-num.lg-spot--hl');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2, '第 3 步');
    await page.waitForSelector('[data-bet="n-0"].lg-spot--hl');
    h.assert(await page.$('.lg-dimmed'), '其他區域變暗');
    while ((await h.tutorialStep(page)).id !== 'layout-straight') await h.tutorialNext(page);
    await page.waitForSelector('[data-bet="n-17"].lg-spot--hl');
    await page.click('[data-tutor="next"]', { force: true });
    h.assertEq((await h.tutorialStep(page)).id, 'layout-straight', 'action 未完成不能前進');
    await page.click('[data-bet="n-17"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'layout-split', '下一步：分注');
    await page.waitForSelector('[data-bet="split-17-20"].lg-spot--hl');
    await page.click('[data-bet="split-17-20"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
  });

  await t.test('教學：完整走完 32 步（每步高亮存在、action 全部完成）→ 練習模式', async (page, h) => {
    await h.openGame(page, 'roulette', 'tutorial');
    await page.waitForSelector('.lg-tutor');
    const total = Number((await page.textContent('.lg-tutor__count')).split('/')[1]);
    h.assert(total >= 14, '步數 ' + total);
    for (let i = 0; i < total; i++) {
      const st = await h.tutorialStep(page);
      h.assertEq(st.index, i, '步驟序');
      if (st.id !== 'strategy-edge') {
        await page.waitForSelector('.lg-spot--hl', { timeout: 2000 }).catch(() => null);
        h.assert((await h.highlighted(page)) > 0, `${st.id} 高亮元素存在`);
      }
      if (await page.$('.lg-tutor__action:not([hidden])')) {
        if (st.id === 'flow-spin') await h.deal(page);
        else await page.click(`[data-bet="${await page.$eval('.rl-board [data-bet].lg-spot--hl', (e) => e.dataset.bet)}"]`);
        await page.waitForSelector('.lg-tutor__action.is-done');
        if (st.id === 'flow-spin') { await h.waitResult(page); await h.closeResult(page); }
      }
      if (i < total - 1) await h.tutorialNext(page);
    }
    h.assert((await page.textContent('[data-tutor="next"]')).includes('去練習模式'), '最後一步按鈕');
    await page.click('[data-tutor="next"]');
    await page.waitForSelector('.lg-game[data-game="roulette"][data-mode="practice"][data-ready="1"]');
    h.assertEq(await page.evaluate(() => LG.progress.pct('roulette')), 100, '教學完成度 100%');
  });

  await t.test('真實：倒數 20 秒、口令、只閃金額', async (page, h) => {
    await h.openGame(page, 'roulette', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    h.assertEq(await page.getAttribute('.lg-countdown', 'data-remaining'), '20', '倒數 20');
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'red', 25);
    await h.waitBanner(page, 'No more bets');
    const flash = await h.waitFlash(page);
    h.assert(flash.net === 25 || flash.net === -25, '閃示金額 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq(await page.evaluate(() => LG.stats.session.current().rounds), 1, 'session 記一局');
    await h.waitBanner(page, 'Place your bets');
  });

  await t.test('真實：外注低於 RM 25 / 內注合計不足 → 不成立並提示', async (page, h) => {
    await h.openGame(page, 'roulette', 'real');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.placeChip(page, 'red', 10);
    await page.waitForFunction(() => [...document.querySelectorAll('.lg-toast')].some((e) => e.textContent.includes('RM 25')));
    await page.waitForSelector('.rl-hist');
    h.assertEq(await h.balance(page), 1000, '不合法的注不扣款');
    h.assertEq(await page.evaluate(() => LG.stats.session.current().rounds), 0, '不記局');
    // 直注上限 500
    await h.waitBanner(page, 'Place your bets');
    await h.selectChip(page, 500);
    await h.placeChip(page, 'n-5');
    await h.placeChip(page, 'n-5');
    h.assertEq(await h.betAmount(page, 'n-5'), 500, '直注上限 RM 500');
  });
}
