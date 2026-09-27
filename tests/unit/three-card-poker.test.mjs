// Three Card Poker：規格 docs/05-game-rules/three-card-poker.md §7 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['three-card-poker'] });
const def = LG.games['three-card-poker'];
const { settle, qualifies, shouldPlay, PAIR_PLUS } = def.logic;
const P = (s) => LG.cards.parseMany(s);
const e3 = (s) => LG.poker.eval3(P(s));

test('註冊：分類、houseEdge 與 00-common 一致、限注', () => {
  assert.equal(def.category, 'poker-table');
  const best = LG.bestEdge(def);
  assert.deepEqual([best.edge, best.best, best.bet.en], [2.32, true, 'Pair Plus']);
  assert.equal(def.houseEdge.find((x) => x.bet.en === 'Ante/Play').edge, 3.37);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 500 });
});

test('eval3：順（A-2-3 最小、Q-K-A 最大）、同花順、三條；順 > 同花', () => {
  assert.equal(e3('AS 2H 3D').cat, 'STRAIGHT');
  assert.equal(e3('QS KH AD').cat, 'STRAIGHT');
  assert.ok(e3('AS 2H 3D').score < e3('2S 3H 4D').score, 'A-2-3 最小順');
  assert.ok(e3('QS KH AD').score > e3('JS QH KD').score, 'Q-K-A 最大順');
  assert.equal(e3('KS AS 2S').cat, 'FLUSH', 'K-A-2 不是順');
  assert.equal(e3('5H 6H 7H').cat, 'SF');
  assert.equal(e3('9S 9H 9D').cat, 'TRIPS');
  assert.ok(e3('2S 3H 4D').score > e3('AH KH JH').score, '最小順 > 最大同花');
  assert.ok(e3('9S 9H 9D').score > e3('QS KH AD').score, '三條 > 順');
  assert.ok(e3('2H 3H 4H').score > e3('AS AH AD').score, '同花順 > 三條');
});

test('Q-6-4 邊界：Q-6-4 Play，Q-6-3 Fold', () => {
  assert.equal(shouldPlay(P('QS 6H 4D')), true);
  assert.equal(shouldPlay(P('QS 6H 3D')), false);
  assert.equal(shouldPlay(P('QS 7H 2D')), true);
  assert.equal(shouldPlay(P('JS TH 8D')), false);
  assert.equal(shouldPlay(P('2S 2H 3D')), true, '一對以上一律跟');
});

test('莊合格：Q 高以上', () => {
  assert.equal(qualifies(P('QS 3H 2D')), true);
  assert.equal(qualifies(P('JS TH 8D')), false);
  assert.equal(qualifies(P('2S 2H 3D')), true);
});

test('結算：莊不合格 → Ante 1:1、Play push', () => {
  const r = settle({ ante: 25, play: 25, player: P('KS 7H 2D'), dealer: P('JC 9D 4H') });
  assert.equal(r.qualifies, false);
  assert.deepEqual(r.lines.map((l) => [l.spot, l.result, l.pay]), [['ante', 'win', 25], ['play', 'push', 0]]);
  assert.deepEqual([r.wagered, r.returned, r.net], [50, 75, 25]);
});

test('結算：莊合格比牌（贏／輸／平）', () => {
  let r = settle({ ante: 25, play: 25, player: P('8S 8H 3D'), dealer: P('AC 9D 4H') });
  assert.deepEqual([r.qualifies, r.returned, r.net], [true, 100, 50]);
  r = settle({ ante: 25, play: 25, player: P('KS 7H 2D'), dealer: P('5C 5D 9H') });
  assert.deepEqual([r.returned, r.net], [0, -50]);
  r = settle({ ante: 25, play: 25, player: P('KS 7H 2D'), dealer: P('KC 7D 2H') });
  assert.deepEqual([r.cmp, r.returned, r.net], [0, 50, 0]);
  r = settle({ ante: 25, folded: true, player: P('9S 7H 2D'), dealer: P('KC 7D 2H') });
  assert.deepEqual([r.wagered, r.net], [25, -25]);
});

test('Pair Plus 三條 30:1；各牌型賠率；棄牌仍結算；只押 Pair Plus', () => {
  let r = settle({ pairPlus: 10, player: P('9S 9H 9D'), dealer: P('AC KD 4H') });
  assert.deepEqual(r.lines.map((l) => [l.spot, l.pay, l.returned]), [['pairPlus', 300, 310]]);
  assert.deepEqual([PAIR_PLUS.PAIR, PAIR_PLUS.FLUSH, PAIR_PLUS.STRAIGHT, PAIR_PLUS.TRIPS, PAIR_PLUS.SF], [1, 4, 6, 30, 40]);
  r = settle({ ante: 10, pairPlus: 10, folded: true, player: P('4S 4H 9D'), dealer: P('AC KD 4H') });
  assert.deepEqual(r.lines.map((l) => [l.spot, l.pay]), [['ante', -10], ['pairPlus', 10]]);
  assert.equal(r.net, 0);
  r = settle({ pairPlus: 10, player: P('AS KH 9D'), dealer: P('2C 3D 7H') });
  assert.equal(r.net, -10);
});

test('Ante Bonus 與 Pair Plus 各自獨立：三條輸給同花順仍領 Ante Bonus 4:1 與 Pair Plus 30:1', () => {
  const r = settle({ ante: 25, play: 25, pairPlus: 25, player: P('9S 9H 9D'), dealer: P('5H 6H 7H') });
  const by = Object.fromEntries(r.lines.map((l) => [l.spot, l.pay]));
  assert.deepEqual(by, { ante: -25, play: -25, anteBonus: 100, pairPlus: 750 });
  assert.equal(r.wagered, 75);
  assert.equal(r.net, 800);
  // 順子 Ante Bonus 1:1、同花順 5:1
  assert.equal(settle({ ante: 10, play: 10, player: P('4S 5H 6D'), dealer: P('AC KD 4H') }).lines.find((l) => l.spot === 'anteBonus').pay, 10);
  assert.equal(settle({ ante: 10, play: 10, player: P('4S 5S 6S'), dealer: P('AC KD 4H') }).lines.find((l) => l.spot === 'anteBonus').pay, 50);
});

test('Pair Plus 優勢精確列舉 = 2.32%', () => {
  const deck = LG.cards.newDeck();
  let ev = 0, n = 0;
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    const m = PAIR_PLUS[LG.poker.eval3([deck[a], deck[b], deck[c]]).cat];
    ev += m ? m : -1; n++;
  }
  assert.equal(n, 22100);
  assert.ok(Math.abs((-ev / n) * 100 - 2.32) < 0.01, String((-ev / n) * 100));
});

test('教學步驟符合規範（≥12 步、四段、≥3 action、highlight 皆設定）', () => {
  const steps = def.create(fakeCtx()).tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.some((s) => /順子 &gt; 同花|順子 > 同花|順子比同花大/.test(s.body)), '教學重點：順 > 同花');
  assert.ok(steps.some((s) => /Q-6-4/.test(s.body)), 'Q-6-4');
});

// ---- Monte Carlo（[slow]）：以 52^3 查表加速
function tables() {
  const deck = LG.cards.newDeck();
  const score = new Float64Array(52 * 52 * 52), pp = new Int8Array(52 * 52 * 52), ab = new Int8Array(52 * 52 * 52);
  const { ANTE_BONUS } = def.logic;
  for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) for (let c = 0; c < 52; c++) {
    if (a === b || b === c || a === c) continue;
    const e = LG.poker.eval3([deck[a], deck[b], deck[c]]);
    const k = (a * 52 + b) * 52 + c;
    score[k] = e.score; pp[k] = PAIR_PLUS[e.cat] || -1; ab[k] = ANTE_BONUS[e.cat] || 0;
  }
  return { score, pp, ab };
}
function deal6(deck, rnd) {
  for (let k = 0; k < 6; k++) {
    const j = k + Math.floor(rnd() * (52 - k));
    const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
  }
}
function mulberry(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('[slow] Monte Carlo：Pair Plus 優勢 2.32% ± 0.2（2,000 萬手）', () => {
  const { pp } = tables();
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const rnd = mulberry(20260927);
  const N = 20000000;
  let s = 0;
  for (let n = 0; n < N; n++) { deal6(deck, rnd); s += pp[(deck[0] * 52 + deck[1]) * 52 + deck[2]]; }
  const edge = (-s / N) * 100;
  assert.ok(Math.abs(edge - 2.32) <= 0.2, `Pair Plus edge ${edge.toFixed(3)}%`);
});

test('[slow] Monte Carlo：Ante/Play（Q-6-4）優勢 3.37% ± 0.3（500 萬手）', () => {
  const { score, ab } = tables();
  const { Q64, QUAL_MIN } = def.logic;
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const rnd = mulberry(7);
  const N = 5000000;
  let s = 0;
  for (let n = 0; n < N; n++) {
    deal6(deck, rnd);
    const kp = (deck[0] * 52 + deck[1]) * 52 + deck[2], kd = (deck[3] * 52 + deck[4]) * 52 + deck[5];
    const ps = score[kp];
    if (ps < Q64) { s -= 1; continue; }
    s += ab[kp];
    const ds = score[kd];
    if (ds < QUAL_MIN) s += 1;
    else if (ps > ds) s += 2;
    else if (ps < ds) s -= 2;
  }
  const edge = (-s / N) * 100;
  assert.ok(Math.abs(edge - 3.37) <= 0.3, `Ante edge ${edge.toFixed(3)}%`);
});

function fakeCtx() {
  return {
    gameId: 'three-card-poker', def, mode: 'tutorial', variant: '', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}
