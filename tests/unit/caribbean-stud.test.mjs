// Caribbean Stud Poker：規格 docs/05-game-rules/caribbean-stud.md §8 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['caribbean-stud'] });
const def = LG.games['caribbean-stud'];
const { settle, qualifies, strategy, progressiveEdge, POOL_SEED, BET_PAY } = def.logic;
const P = (s) => LG.cards.parseMany(s);

test('註冊：分類、houseEdge 與 00-common 一致、限注', () => {
  assert.equal(def.category, 'poker-table');
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 5.22);
  assert.equal(best.best, true);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 500 });
  assert.deepEqual(LG.limitsFor(def, 'practice'), { min: 10, max: 100000 });
});

test('合格判定：A-K-x-x-x 合格；A-Q-J-x-x 不合格；任何對合格', () => {
  assert.equal(qualifies(P('AS KD 7H 4C 2S')), true);
  assert.equal(qualifies(P('AS QD JH 4C 2S')), false);
  assert.equal(qualifies(P('KS QD JH 9C 7S')), false);
  assert.equal(qualifies(P('2S 2D 7H 4C 9S')), true);
  assert.equal(qualifies(P('AS AD 7H 4C 9S')), true);
  assert.equal(qualifies(P('3S 4D 5H 6C 7S')), true);   // 順子
});

test('結算情境一：莊不合格 → Ante 1:1、Bet push', () => {
  const r = settle({ ante: 25, bet: 50, folded: false, player: P('8S 8H 4D 5C 2S'), dealer: P('AC QD 7H 4S 3D') });
  assert.equal(r.qualifies, false);
  const [a, b] = r.lines;
  assert.deepEqual([a.spot, a.result, a.pay, a.returned], ['ante', 'win', 25, 50]);
  assert.deepEqual([b.spot, b.result, b.pay, b.returned], ['bet', 'push', 0, 50]);
  assert.deepEqual([r.wagered, r.returned, r.net], [75, 100, 25]);
});

test('結算情境二：莊合格、你兩對贏 → Ante 1:1、Bet 2:1', () => {
  const r = settle({ ante: 25, bet: 50, folded: false, player: P('JS JH 4D 4C 9S'), dealer: P('KC KD 7H 5S 3D') });
  assert.equal(r.qualifies, true);
  assert.equal(r.cmp, 1);
  assert.deepEqual(r.lines.map((l) => l.pay), [25, 100]);
  assert.deepEqual([r.returned, r.net], [200, 125]);
  assert.match(r.lines[1].formula, /RM 50 × 2（兩對 2:1）= \+RM 100/);
});

test('結算情境三：莊合格且莊勝 → 輸 Ante + Bet；平手 push；棄牌只輸 Ante', () => {
  let r = settle({ ante: 25, bet: 50, folded: false, player: P('5S 5H KD 8C 2S'), dealer: P('QC QD 7H 4S 3D') });
  assert.deepEqual([r.returned, r.net, r.outcome], [0, -75, 'lose']);
  r = settle({ ante: 25, bet: 50, folded: false, player: P('AS KH 8D 5C 2S'), dealer: P('AC KD 8H 5S 2H') });
  assert.equal(r.cmp, 0);
  assert.deepEqual([r.returned, r.net, r.outcome], [75, 0, 'push']);
  r = settle({ ante: 25, bet: 0, folded: true, player: P('9S 7H 5D 3C 2S'), dealer: P('QC QD 7H 4S 3D') });
  assert.deepEqual([r.wagered, r.returned, r.net], [25, 0, -25]);
  // A-K 贏也是 1:1
  r = settle({ ante: 10, bet: 20, folded: false, player: P('AS KH 9D 5C 2S'), dealer: P('AC KD 8H 5S 2H') });
  assert.deepEqual([r.qualifies, r.cmp, r.net], [true, 1, 30]);
});

test('Bet 賠付表：規格九列', () => {
  const C = LG.poker.CATEGORY;
  assert.deepEqual(
    [C.PAIR, C.TWO_PAIR, C.TRIPS, C.STRAIGHT, C.FLUSH, C.FULL_HOUSE, C.QUADS, C.STRAIGHT_FLUSH, C.ROYAL].map((c) => BET_PAY[c]),
    [1, 2, 3, 4, 5, 7, 20, 50, 100]);
  const r = settle({ ante: 10, bet: 20, folded: false, player: P('TS JS QS KS AS'), dealer: P('AC KD 8H 5C 2H') });
  assert.equal(r.lines[1].pay, 2000);
});

test('旁注：四條 +RM 500（不論莊牌）；同花順 10% 獎池；皇家 100% 後回種子；未中 −RM 5', () => {
  let r = settle({ ante: 25, bet: 50, progressive: 5, folded: false, player: P('7S 7H 7D 7C 2S'), dealer: P('AC QD 9H 4S 3D') });
  const pl = r.lines.find((l) => l.spot === 'progressive');
  assert.equal(r.qualifies, false);
  assert.deepEqual([pl.result, pl.pay, pl.returned], ['win', 500, 505]);
  r = settle({ ante: 25, bet: 50, progressive: 5, folded: false, player: P('5H 6H 7H 8H 9H'), dealer: P('AC QD 9S 4S 3D'), pool: 120000 });
  assert.equal(r.lines.find((l) => l.spot === 'progressive').pay, 12000);
  assert.equal(r.poolAfter, 108000);
  r = settle({ ante: 25, bet: 50, progressive: 5, folded: false, player: P('TH JH QH KH AH'), dealer: P('AC QD 9S 4S 3D'), pool: 250000 });
  assert.equal(r.lines.find((l) => l.spot === 'progressive').pay, 250000);
  assert.equal(r.poolAfter, POOL_SEED);
  r = settle({ ante: 25, bet: 50, progressive: 5, folded: false, player: P('2H 2S 7H 8D 9H'), dealer: P('AC QD 9S 4S 3D') });
  assert.equal(r.lines.find((l) => l.spot === 'progressive').pay, -5);
  r = settle({ ante: 25, progressive: 5, folded: true, player: P('2H 5H 7H 8H JH'), dealer: P('AC QD 9S 4S 3D') });
  assert.equal(r.lines.find((l) => l.spot === 'progressive').pay, -5, '棄牌旁注也輸');
});

test('旁注優勢：獎池 RM 10 萬時遠超過 25%，獎池越大越低', () => {
  const e = progressiveEdge(POOL_SEED);
  assert.ok(e > 25 && e < 95, String(e));
  assert.ok(progressiveEdge(1000000) < e);
});

test('策略三條（提示）', () => {
  assert.equal(strategy(P('2S 2H 7D 9C JS'), P('AH')[0]).action, 'raise');
  assert.equal(strategy(P('AS QH 7D 9C JS'), P('5H')[0]).action, 'fold');
  // A-K：莊明牌 2–Q 且同點數 → 跟
  assert.equal(strategy(P('AS KH 8D 5C 2S'), P('8C')[0]).action, 'raise');
  assert.equal(strategy(P('AS KH 8D 5C 2S'), P('9C')[0]).action, 'fold');
  // A-K：莊明牌 A/K 且有 Q 或 J → 跟
  assert.equal(strategy(P('AS KH QD 5C 2S'), P('KC')[0]).action, 'raise');
  assert.equal(strategy(P('AS KH JD 5C 2S'), P('AC')[0]).action, 'raise');
  assert.equal(strategy(P('AS KH TD 5C 2S'), P('AC')[0]).action, 'fold');
});

test('教學步驟符合規範（≥12 步、四段、≥3 action、highlight 皆設定）', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
  assert.ok(steps.filter((s) => s.action).length >= 3);
});

test('[slow] Monte Carlo 100 萬手，規格策略下 Ante 優勢 4.5%–6%', () => {
  LG.rng.seed(20260927);
  const deck = LG.cards.newDeck();
  const N = 1000000;
  let total = 0;
  const p = new Array(5), d = new Array(5);
  const { resolve } = def.logic;
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < 10; k++) {   // 部分洗牌：取 10 張
      const j = k + Math.floor(LG.rng.random() * (52 - k));
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
    }
    for (let k = 0; k < 5; k++) { p[k] = deck[k]; d[k] = deck[k + 5]; }
    const pe = LG.poker.eval5(p);
    if (strategy(p, d[0], pe).action === 'fold') { total -= 1; continue; }
    const r = resolve(p, d);
    if (!r.q) total += 1;
    else if (r.cmp > 0) total += 1 + 2 * r.mult;
    else if (r.cmp < 0) total -= 3;
  }
  LG.rng.seed(null);
  const edge = (-total / N) * 100;
  assert.ok(edge >= 4.5 && edge <= 6, `edge ${edge.toFixed(3)}%`);
});

function fakeCtx() {
  return {
    gameId: 'caribbean-stud', def, mode: 'tutorial', variant: '', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}
