// Pai Gow Poker 牌九撲克：規格 docs/05-game-rules/paigow-poker.md §7 驗收測試 + 結算、Fortune、教學規範、遊戲流程
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

// [slow]：npm test 以 --test-skip-pattern 略過；npm run test:slow 執行
const SLOW = process.env.npm_lifecycle_event === 'test' && !process.env.SLOW ? { skip: '[slow] 請用 npm run test:slow' } : {};

const LG = loadLG({ games: ['paigow-poker'] });
const def = LG.games['paigow-poker'];
const PG = LG.paigow;
const K = PG.CATEGORY;
const P = LG.cards.parseMany;
const { settle, fortuneOf, describeHigh, describeLow, FORTUNE } = def.logic;
const e5 = (s) => PG.eval5(P(s));
const split = (h, l) => ({ high: P(h), low: P(l) });
const ids = (a) => a.map((c) => c.id).sort().join(' ');
const sorted = (s) => s.split(' ').sort().join(' ');

test('paigow-poker 註冊：分類、houseEdge 2.84% best、限注', () => {
  assert.equal(def.category, 'poker-table');
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 2.84);
  assert.equal(best.best, true);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 50, max: 3000 });
  assert.deepEqual(LG.limitsFor(def, 'practice'), { min: 10, max: 100000 });
  assert.equal(def.logic.ARRANGE_SECONDS, 60, '真實模式排牌 60 秒');
  assert.equal(def.logic.COMMISSION, 0.05);
});

test('驗收：小丑 — A-A-X-9-8 = 三條 A；小丑補 9-10-J-Q = 順；不能補對子', () => {
  const aa = e5('AS AH XJ 9D 8C');
  assert.equal(aa.cat, K.TRIPS);
  assert.equal(aa.ranks[0], 14);
  assert.match(describeHigh(aa), /三條 A.*小丑當 A/);
  const st = e5('9S TD JC QH XJ');
  assert.equal(st.cat, K.STRAIGHT);
  assert.match(describeHigh(st), /K 高順子.*小丑補 K/);
  const kk = e5('KS KH 7D 4C XJ');
  assert.equal(kk.cat, K.PAIR, 'K-K-小丑 不是三條 K');
  assert.deepEqual(kk.ranks.slice(0, 3), [13, 13, 14], '小丑當 A 踢腳');
  assert.equal(e5('7S 7H 4D 4C XJ').cat, K.TWO_PAIR, '不能補成葫蘆');
  // 低手小丑 = A
  assert.equal(PG.eval2(P('AS XJ')).cat, 'PAIR');
  assert.match(describeLow(PG.eval2(P('XJ 9H'))), /A-9 高牌.*小丑當 A/);
});

test('驗收：A-2-3-4-5 為第二大順（僅次 T-J-Q-K-A，大於 9-T-J-Q-K）', () => {
  const wheel = e5('AS 2H 3D 4C 5S');
  const nineK = e5('9S TH JD QC KS');
  const broadway = e5('TS JH QD KC AS');
  assert.equal(wheel.cat, K.STRAIGHT);
  assert.equal(wheel.score > nineK.score, true, 'A2345 > 9TJQK（房規）');
  assert.equal(broadway.score > wheel.score, true, 'TJQKA > A2345');
  assert.match(describeHigh(wheel), /A-2-3-4-5 順子（第二大順/);
  // 比牌也照這個順序
  const r = PG.compare(split('AS 2H 3D 4C 5S', 'QD JH'), split('9S TH JD QC KS', '4H 3C'));
  assert.deepEqual([r.high, r.low, r.result], [1, 1, 'win']);
  assert.match(describeHigh(e5('AH 2H 3H 4H 5H')), /A-2-3-4-5 同花順/);
  assert.equal(describeHigh(e5('AS AH AD AC XJ')), '五條 A（Five Aces）');
});

// 房規九條（每條 ≥ 1 筆；與 lib 測資不同組，驗遊戲會用到的 houseWay 行為）
const HW = [
  ['AD QS 8C 6H 4S 3D 2H', 'QS 8C', 1],
  ['JS JD AC 9H 7S 5D 3C', 'AC 9H', 2],
  ['4S 4D 2C 2H AH TD 7C', 'AH TD', 3],   // 兩對皆 ≤ 6 且有 A 單牌 → A 放低
  ['QS QD 5C 5H KS 9D 2C', '5C 5H', 3],   // 否則拆，小對放低
  ['TS TD 8C 8H 3S 3D KC', 'TS TD', 4],   // 三對：最高對放低
  ['7S 7D 7C KH QS 5D 2C', 'KH QS', 5],   // 三條：最高兩單牌放低
  ['XJ AD AC KH 9S 5D 2C', 'XJ KH', 5],   // 三條 A（含小丑）→ 拆一張 A（lib 拆小丑）放低
  ['3S 4D 5C 6H 7S QD 9C', 'QD 9C', 6],   // 順子：低手放最大兩張
  ['2H 6H 9H JH KH AS 4C', 'AS 4C', 6],   // 同花
  ['QS QD QC 8H 8S 6D 2C', '8H 8S', 7],   // 葫蘆：對子放低
  ['4S 4D 4C 4H KS QD 2C', 'KS QD', 8],   // 四條 2–6 不拆
  ['AS AD AC AH KS 9D 2C', 'AS AD', 8],   // 四條 A 一律拆
  ['AS AD AC AH XJ 7D 2C', 'AS AD', 9],   // 五條 A
];

test('驗收：houseWay 九條規則各 ≥ 1 筆，回傳 rule/why，排法合法', () => {
  const seen = new Set();
  for (const [h, low, rule] of HW) {
    const r = PG.houseWay(P(h));
    assert.equal(r.rule, rule, `${h} 條號`);
    assert.equal(ids(r.low), sorted(low), `${h} 低手`);
    assert.equal(ids(r.high.concat(r.low)), sorted(h), '7 張都用到');
    assert.ok(PG.isValidSplit(r.high, r.low), `${h} 合法`);
    assert.equal(r.why, PG.RULE_TEXT[rule]);
    seen.add(rule);
  }
  assert.equal(seen.size, 9, '九條都有測資');
});

test('驗收：isValidSplit 檢查 Foul；Foul 直接判輸', () => {
  assert.equal(PG.isValidSplit(P('QC 9H 7S 4D 2C'), P('KS KD')), false, '低手一對 K > 高手 Q 高牌');
  assert.equal(PG.isValidSplit(P('KS KD 7S 4D 2C'), P('QC 9H')), true);
  assert.equal(PG.isValidSplit(P('KS QD 7S 4D 2C'), P('AC 9H')), false, 'A 高 > K 高');
  assert.equal(PG.isValidSplit(P('KS KD 7S 4D'), P('QC 9H')), false, '高手不是 5 張');
  const r = settle({ main: 100 }, P('KS KD QC 9H 7S 4D 2C'), split('QC 9H 7S 4D 2C', 'KS KD'), split('3S 4D 6C 8H TS', '2C 5H'));
  assert.equal(r.cmp.foul, true);
  assert.equal(r.net, -100);
  assert.equal(r.returned, 0);
});

test('結算：兩贏扣 5% 佣、一贏一輸 push、兩輸輸、copy 歸莊', () => {
  const seven = P('KS KD QC 9H 7S 4D 2C');
  const you = split('KS KD 7S 4D 2C', 'QC 9H');
  // 兩手都贏
  let r = settle({ main: 100 }, seven, you, split('QH QD 6H 5C 3S', 'JS 8C'));
  assert.deepEqual([r.cmp.result, r.net, r.returned], ['win', 95, 195]);
  assert.match(r.lines[0].formula, /RM 100 × 0\.95 = \+RM 95.*拿回 RM 195/);
  // 高輸低贏 → push
  r = settle({ main: 100 }, seven, you, split('AC AD 6H 5C 3S', 'JS 8C'));
  assert.deepEqual([r.cmp.high, r.cmp.low, r.cmp.result, r.net, r.returned], [-1, 1, 'push', 0, 100]);
  assert.match(r.lines[0].formula, /退回（push）= RM 0/);
  // 兩手都輸
  r = settle({ main: 100 }, seven, you, split('AC AD 6H 5C 3S', 'KH JD'));
  assert.deepEqual([r.cmp.result, r.net], ['lose', -100]);
  // copy：高手一模一樣 + 低手你贏 → push（copy 算莊贏）
  const copyHigh = split('KH KC 7D 4S 2D', 'JS 8C');
  r = settle({ main: 100 }, seven, you, copyHigh);
  assert.deepEqual([r.cmp.high, r.cmp.low, r.cmp.result], [0, 1, 'push']);
  // 兩手都 copy → 輸
  r = settle({ main: 100 }, seven, you, split('KH KC 7D 4S 2D', 'QS 9D'));
  assert.deepEqual([r.cmp.high, r.cmp.low, r.cmp.result, r.net], [0, 0, 'lose', -100]);
  // 小額：RM 25 × 0.95 = 23.75
  r = settle({ main: 25 }, seven, you, split('QH QD 6H 5C 3S', 'JS 8C'));
  assert.equal(r.net, 23.75);
});

test('Fortune 旁注：賠付表與規格一致、以 7 張最佳牌型判', () => {
  const table = Object.fromEntries(FORTUNE.map((f) => [f.cat, f.mult]));
  assert.deepEqual(table, {
    [K.STRAIGHT]: 2, [K.TRIPS]: 3, [K.FLUSH]: 4, [K.FULL_HOUSE]: 5,
    [K.QUADS]: 25, [K.STRAIGHT_FLUSH]: 50, [K.ROYAL]: 150, [K.FIVE_ACES]: 400,
  });
  assert.equal(fortuneOf(P('9S 9D 9C AH KS 5D 2C')).mult, 3, '三條');
  assert.equal(fortuneOf(P('3S 4D 5C 6H 7S QD 9C')).mult, 2, '順子');
  assert.equal(fortuneOf(P('9S TD JC QH XJ 3D 2C')).mult, 2, '小丑補順');
  assert.equal(fortuneOf(P('2H 6H 9H JH XJ AS 4C')).mult, 4, '小丑補同花');
  assert.equal(fortuneOf(P('QS QD QC 8H 8S 6D 2C')).mult, 5, '葫蘆');
  assert.equal(fortuneOf(P('4S 4D 4C 4H KS QD 2C')).mult, 25, '四條');
  assert.equal(fortuneOf(P('5H 6H 7H 8H 9H AS 2C')).mult, 50, '同花順');
  assert.equal(fortuneOf(P('TH JH QH KH XJ 2S 3C')).mult, 150, '皇家（小丑補）');
  assert.equal(fortuneOf(P('AS AD AC AH XJ 7D 2C')).mult, 400, '五條 A');
  assert.equal(fortuneOf(P('KS KD QC 9H 7S 4D 2C')).mult, 0, '一對不賠');
  assert.equal(fortuneOf(P('KS KD QC QH 7S 4D 2C')).mult, 0, '兩對不賠');
  // 結算：主注 push + Fortune 三條
  const seven = P('9S 9D 9C AH KS 5D 2C');
  const r = settle({ main: 100, fortune: 10 }, seven, split('9S 9D 9C 5D 2C', 'AH KS'), split('3S 4D 5C 6H 7S', 'QS JD'));
  assert.equal(r.cmp.result, 'push');
  assert.deepEqual([r.fortuneNet, r.net, r.wagered, r.returned], [30, 30, 110, 140]);
  assert.match(r.lines[1].formula, /Fortune RM 10 × 3 = \+RM 30（三條；拿回 RM 40）/);
  // Fortune 輸
  const r2 = settle({ main: 100, fortune: 10 }, P('KS KD QC 9H 7S 4D 2C'), split('KS KD 7S 4D 2C', 'QC 9H'), split('QH QD 6H 5C 3S', 'JS 8C'));
  assert.deepEqual([r2.mainNet, r2.fortuneNet, r2.net], [95, -10, 85]);
});

function fakeCtx(mode = 'tutorial') {
  const hooks = { win: null, explained: [], recorded: [] };
  const ctx = {
    gameId: 'paigow-poker', def, mode, variant: null,
    limits: LG.limitsFor(def, mode), denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false,
    isReal: mode === 'real', isPractice: mode === 'practice', isTutorial: mode === 'tutorial',
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {},
    explain(o) { hooks.explained.push(o); }, recordRound(r) { hooks.recorded.push(r); },
    dealer: { say() {} },
    bettingWindow(o) { const h = { o, close() { o.bets.lock(); o.onClose({ auto: false, ok: o.bets.validate().ok, validation: o.bets.validate() }); }, cancel() {} }; hooks.win = h; return h; },
    nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
  return { ctx, hooks };
}

test('教學步驟：≥ 14 步、四段、≥ 3 action，含小丑 / A-2-3-4-5 / Foul / 41% push', () => {
  const { ctx } = fakeCtx();
  const inst = def.create(ctx);
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 14 });
  assert.deepEqual(lint.problems, []);
  const all = steps.map((s) => s.title + s.body).join('\n');
  for (const kw of ['小丑', 'A-2-3-4-5', 'Foul', '41%', 'No more bets', 'RM 100 × 0.95 = RM 95', 'copy', 'Fortune', '60 秒', '2.84%', 'RM 500']) {
    assert.ok(all.includes(kw), `教學缺少「${kw}」`);
  }
  const sections = new Set(steps.map((s) => s.section));
  assert.deepEqual([...sections], ['layout', 'flow', 'payout', 'strategy']);
  steps.forEach((s) => { assert.ok(s.highlight === null || Array.isArray(s.highlight), s.id); });
});

test('遊戲流程（教學擺牌）：下注 → 發牌 → Foul 擋住 → 房規排牌 → 確認 → 結算 +95', async () => {
  LG.store.reset();
  const { ctx, hooks } = fakeCtx('tutorial');
  const inst = def.create(ctx);
  inst.mount(globalThis.document.createElement('section'));
  assert.equal(inst.state.phase, 'betting');
  inst.bets.place('main', 100);
  hooks.win.close();
  assert.equal(inst.state.phase, 'arranging');
  assert.equal(LG.bank.balance(), 900, 'No more bets 後扣款');
  assert.equal(ids(inst.state.player), sorted('KS KD QC 9H 7S 4D 2C'), '教學第一手是固定牌');
  inst.demo.foul();
  assert.equal(ids(inst.split().low), 'KD KS', 'Foul 示範：對子放低');
  assert.equal(PG.isValidSplit(inst.split().high, inst.split().low), false);
  inst.demo.ensureArranging();
  assert.equal(inst.state.phase, 'arranging', 'Foul 時確認無效（仍在排牌）');
  // 房規排牌
  const hw = PG.houseWay(inst.state.player);
  assert.equal(hw.rule, 2);
  assert.equal(ids(hw.low), 'QC 9H'.split(' ').sort().join(' '));
  inst.actions.reset();
  assert.equal(inst.split().low.length, 0, '重排：全部回高手');
  inst.actions.toggle('KS');
  inst.actions.set();
  assert.equal(inst.state.phase, 'arranging', '低手只有 1 張不能確認');
  inst.actions.toggle('KS');
  inst.actions.houseWay();
  assert.equal(inst.state.hwClicks, 1);
  assert.equal(ids(inst.split().low), ids(hw.low));
  assert.ok(PG.isValidSplit(inst.split().high, inst.split().low));
  inst.actions.set();
  assert.equal(inst.state.phase, 'revealing');
  for (let i = 0; i < 50 && inst.state.phase !== 'settled'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(inst.state.phase, 'settled');
  assert.equal(LG.bank.balance(), 1095, '兩手都贏：拿回 RM 195');
  assert.deepEqual(hooks.recorded[0], { wagered: 100, net: 95, outcome: 'win' });
  const ex = hooks.explained[0];
  assert.match(ex.hand, /一對 K/);
  assert.match(ex.hand, /一對 Q/);
  assert.match(ex.result, /兩手都贏/);
  assert.match(ex.formula, /RM 100 × 0\.95 = \+RM 95/);
  assert.match(ex.why, /5% 佣金/);
  inst.unmount();
});

test('[slow] Monte Carlo：玩家與莊家都照房規，優勢 2–4%、push 38–44%', SLOW, () => {
  LG.rng.seed(20240927);
  const deck = LG.cards.newDeck({ jokers: 1 });
  const n = 100000;
  let net = 0, push = 0;
  for (let i = 0; i < n; i++) {
    LG.rng.shuffle(deck);
    const p7 = deck.slice(0, 7), d7 = deck.slice(7, 14);
    const r = settle({ main: 1 }, p7, PG.houseWay(p7), PG.houseWay(d7));
    net += r.net;
    if (r.cmp.result === 'push') push++;
  }
  const edge = (-net / n) * 100, pr = (push / n) * 100;
  assert.ok(edge > 2 && edge < 4, `edge ${edge.toFixed(2)}%`);
  assert.ok(pr > 38 && pr < 44, `push ${pr.toFixed(2)}%`);
});

test('[slow] Monte Carlo：Fortune 旁注優勢約 8.6%（6–11%）', SLOW, () => {
  LG.rng.seed(99);
  const deck = LG.cards.newDeck({ jokers: 1 });
  const n = 200000;
  let net = 0;
  for (let i = 0; i < n; i++) {
    LG.rng.shuffle(deck);
    const m = fortuneOf(deck.slice(0, 7)).mult;
    net += m ? m : -1;
  }
  const edge = (-net / n) * 100;
  assert.ok(edge > 6 && edge < 11, `fortune edge ${edge.toFixed(2)}%`);
});
