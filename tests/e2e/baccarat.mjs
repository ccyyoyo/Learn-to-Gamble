// 百家樂 e2e：三模式、四變體、咪牌、教學、真實模式限注與倒數。見 docs/07-test-plan.md §3
const ID = 'baccarat';

/** 咪牌：一直拖曳直到出現結果（練習）或沒有蓋牌可掀且閃示出現（真實） */
async function squeezeAll(page, h, doneSel) {
  for (let i = 0; i < 8; i++) {
    const hit = await page.waitForSelector(`.lg-card.is-squeeze, ${doneSel}`);
    if (await hit.evaluate((e, s) => e.matches(s), doneSel)) return i;
    await h.dragSqueeze(page);
  }
  throw new Error('咪牌超過 8 次仍未結算');
}

export default async function (t) {
  await t.test('三模式皆可進入、data-ready、390px 不溢出', async (page, h) => {
    for (const mode of ['tutorial', 'practice', 'real']) {
      await h.openGame(page, ID, mode);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      h.assert(w <= 390, `${mode} 橫向溢出 ${w}`);
    }
    h.assert(await page.$('[data-action="real-start"]'), '真實模式進場 modal');
    const txt = await page.textContent('.lg-modal');
    h.assert(txt.includes('RM 50') && txt.includes('15 秒'), '進場說明：' + txt);
  });

  await t.test('練習 classic：押莊 → 發牌 → 四段結果 → 珠盤路一格', async (page, h) => {
    await h.openGame(page, ID, 'practice', 'classic');
    for (const s of ['player', 'banker', 'tie', 'playerPair', 'bankerPair']) h.assert(await page.$(`[data-bet="${s}"]`), s);
    h.assert(!(await page.$('[data-bet="super6"]')), 'classic 沒有 Super 6');
    h.assert(!(await page.$('.bac-note')), 'classic 沒有半賠註記');
    h.assert((await page.textContent('[data-bet="banker"]')).includes('0.95'), '莊格顯示 0.95');
    await h.placeChip(page, 'banker', 100);
    await h.placeChip(page, 'tie', 10);
    h.assertEq(await h.balance(page), 1000, '下注階段不扣款');
    await h.deal(page);
    await h.waitResult(page);
    const rows = await page.$$eval('.lg-result__v', (e) => e.map((x) => x.dataset.k));
    h.assertEq(rows.join(','), 'hand,result,formula,why', '四段');
    const net = await page.evaluate(() => LG.modes.instance().state.last.r.net);
    h.assertEq(await h.balance(page), 1000 + net, '餘額 = 1000 + 淨額');
    h.assertEq(await page.$$eval('.bac-bead__c[data-outcome]', (e) => e.length), 1, '珠盤路一格');
    h.assertEq(await page.evaluate(() => LG.stats.get('baccarat').rounds), 1, 'stats');
    await h.closeResult(page);
    h.assert(await page.$('[data-action="deal"]'), '下一局發牌按鈕');
  });

  await t.test('super6 / tiger：旁注列、半賠註記、下注→發牌→結算', async (page, h) => {
    await h.openGame(page, ID, 'practice', 'super6');
    h.assert((await page.textContent('[data-bet="banker"]')).includes('Banker wins on 6 pays 1/2'), 'super6 半賠註記');
    h.assertEq(await page.$$eval('.bac-sides [data-bet]', (e) => e.map((x) => x.dataset.bet).join()), 'super6');
    await h.placeChip(page, 'player', 50);
    await h.placeChip(page, 'super6', 10);
    await h.deal(page);
    await h.waitResult(page);
    await h.openGame(page, ID, 'practice', 'tiger');
    h.assert((await page.textContent('[data-bet="banker"]')).includes('Banker wins on 6 pays 1/2'), 'tiger 半賠註記');
    h.assertEq(await page.$$eval('.bac-sides [data-bet]', (e) => e.map((x) => x.dataset.bet).join()), 'tiger,bigTiger,smallTiger,tigerTie,tigerPair');
    await h.placeChip(page, 'banker', 50);
    await h.placeChip(page, 'tigerPair', 10);
    await h.placeChip(page, 'smallTiger', 10);
    await h.deal(page);
    await h.waitResult(page);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    h.assert(w <= 390, 'tiger 桌不溢出 ' + w);
  });

  await t.test('練習提示：建議押莊、旁注紅字', async (page, h) => {
    await h.openGame(page, ID, 'practice', 'classic');
    const vis = () => page.$eval('.bac-hint', (e) => !e.hidden);
    if (!(await vis())) await page.click('[data-action="hints"]');
    h.assert((await page.textContent('.bac-hint')).includes('1.06%'), '建議押莊');
    h.assert(await page.$eval('[data-bet="tie"] .bac-risk', (e) => getComputedStyle(e).display !== 'none'), '旁注紅字');
    await page.click('[data-action="hints"]');
    h.assert(!(await vis()), '提示關閉');
  });

  await t.test('咪牌：牌蓋著、口令 Card please、全部掀完才唱牌結算', async (page, h) => {
    await h.openGame(page, ID, 'practice', 'squeeze');
    await h.placeChip(page, 'player', 25);
    await h.deal(page);
    await page.waitForSelector('.lg-card.is-squeeze');
    await h.waitBanner(page, 'Card please');
    h.assertEq(await page.$$eval('.lg-card.is-squeeze', (e) => e.length), 4, '四張蓋牌');
    h.assert(!(await page.$('.lg-result')), '掀牌前不結算');
    await h.dragSqueeze(page);
    h.assertEq(await page.$$eval('.lg-card.is-squeeze', (e) => e.length), 3, '掀開一張');
    h.assert(!(await page.$('.lg-result')), '沒掀完不結算');
    await squeezeAll(page, h, '.lg-result');
    await h.waitResult(page);
    h.assertEq(await page.$$eval('.bac-bead__c[data-outcome]', (e) => e.length), 1, '珠盤路');
  });

  await t.test('教學：前 3 步前進、每步高亮存在、互動題、咪牌練習', async (page, h) => {
    await h.openGame(page, ID, 'tutorial', 'classic');
    await page.waitForSelector('.lg-tutor');
    await page.waitForSelector('.lg-spot--hl');
    await h.tutorialNext(page);
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).index, 2, '第 3 步');
    await page.waitForSelector('[data-bet="tie"].lg-spot--hl');
    // 每一步的 highlight 都指向存在的元素
    const missing = await page.evaluate(async () => {
      const tut = LG.tutorial.current();
      const out = [];
      for (let k = 0; k < tut.steps.length; k++) {
        tut.go(k);
        await new Promise((r) => requestAnimationFrame(() => r()));
        for (const s of tut.steps[k].highlight || []) if (!document.querySelector(s)) out.push(`${tut.steps[k].id}: ${s}`);
      }
      return { out, n: tut.steps.length };
    });
    h.assertEq(missing.out.join(' | '), '', '缺少高亮元素');
    h.assert(missing.n >= 14, '步數 ' + missing.n);
    // 規則表
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'flow-banker-third')); });
    h.assert(await page.$('.lg-tutor__body table.lg-datatable'), '第三張牌規則表');
    // 咪牌練習
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'flow-squeeze')); });
    await h.dragSqueeze(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
    // 5% 佣互動題：先答錯再答對
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'payout-commission')); });
    await page.click('[data-bac-quiz="commission"][data-answer="RM 200"]');
    await page.click('[data-tutor="next"]', { force: true });
    h.assertEq((await h.tutorialStep(page)).id, 'payout-commission', '答錯不能前進');
    await page.click('[data-bac-quiz="commission"][data-answer="RM 195"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
    await h.tutorialNext(page);
    h.assertEq((await h.tutorialStep(page)).id, 'payout-super6');
    await page.click('[data-bac-quiz="super6"][data-answer="RM 150"]');
    await page.waitForSelector('.lg-tutor__action.is-done');
  });

  await t.test('教學：下注 + 發牌 action 完成一局', async (page, h) => {
    await h.openGame(page, ID, 'tutorial', 'tiger');
    await page.waitForSelector('.lg-tutor');
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'flow-place')); });
    await h.placeChip(page, 'banker', 50);
    await page.waitForSelector('.lg-tutor__action.is-done');
    await page.evaluate(() => { const t = LG.tutorial.current(); t.go(t.steps.findIndex((s) => s.id === 'flow-deal')); });
    await h.deal(page);
    await h.waitResult(page);
    await page.waitForSelector('.lg-tutor__action.is-done');
  });

  await t.test('真實模式：限注、倒數、口令、只閃金額', async (page, h) => {
    await h.openGame(page, ID, 'real', 'classic');
    await h.startReal(page);
    await h.waitCountdown(page);
    await h.waitBanner(page, 'Place your bets');
    const lim = await page.evaluate(() => {
      const b = LG.modes.instance().bets;
      return ['banker', 'player', 'tie', 'playerPair', 'bankerPair'].map((s) => `${s}:${b.limitFor(s).min}-${b.limitFor(s).max}`).join(' ');
    });
    h.assertEq(lim, 'banker:50-5000 player:50-5000 tie:10-500 playerPair:10-1000 bankerPair:10-1000', '限注');
    await h.placeChip(page, 'tie', 1000);
    h.assert((await h.toastText(page)).includes('RM 500'), '和上限 toast');
    h.assertEq(await h.betAmount(page, 'tie'), 0, '超過上限不下注');
    await h.placeChip(page, 'banker', 50);
    await h.waitBanner(page, 'No more bets');
    const flash = await h.waitFlash(page);
    h.assert([47.5, -50, 0].includes(flash.net), '閃示 ' + flash.net);
    h.assert(!(await page.$('.lg-result')), '真實模式沒有結果面板');
    h.assertEq(await page.evaluate(() => LG.stats.session.current().rounds), 1, 'session');
    await h.waitBanner(page, 'Place your bets');
  });

  await t.test('真實模式咪牌：Card please → 掀完 → 閃示', async (page, h) => {
    await h.openGame(page, ID, 'real', 'squeeze');
    await h.startReal(page);
    await h.waitBanner(page, 'Place your bets');
    await h.placeChip(page, 'player', 50);
    await h.waitBanner(page, 'Card please');
    const before = await h.flashCount(page);
    h.assertEq(before, 0, '掀牌前沒有閃示');
    await page.evaluate(() => { window.__done = false; const n = LG.ui.flashCount || 0; const iv = setInterval(() => { if ((LG.ui.flashCount || 0) > n) { window.__done = true; clearInterval(iv); } }, 20); });
    for (let i = 0; i < 8; i++) {
      await page.waitForFunction(() => window.__done || document.querySelector('.lg-card.is-squeeze'));
      if (await page.evaluate(() => window.__done)) break;
      await h.dragSqueeze(page);
    }
    await h.waitFlash(page, before);
  });
}
