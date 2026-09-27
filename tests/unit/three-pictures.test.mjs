// 三公 Three Pictures：點數/牌型、比牌、結算、Monte Carlo 優勢、教學規範
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['three-pictures'] });
const def = LG.games['three-pictures'];
const { evaluate, compare, settle, dealHands, simulate, RULES, MC_EDGE } = def.logic;
const P = (s) => LG.cards.parseMany(s);
const E = (s) => evaluate(P(s));
const H = (b, s1, s2, s3) => ({ banker: P(b), seats: { 1: P(s1), 2: P(s2), 3: P(s3) } });

test('三公 註冊：houseEdge（模擬值 approx）、限注、倒數', () => {
  assert.equal(def.category, 'table');
  const best = LG.bestEdge(def);
  assert.equal(best.approx, true);
  assert.equal(best.edge, MC_EDGE);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 50, max: 3000 });
  assert.equal(def.countdown, 15);
});

test('三公 點數與牌型：K-Q-J = 三公；K-9-Q = 9 點兩公；5-5-A = 1 點', () => {
  const a = E('KS QH JD');
  assert.equal(a.three, true);
  assert.equal(a.name.zh, '三公');
  assert.equal(a.mult, 3);
  const b = E('KS 9H QD');
  assert.deepEqual([b.points, b.pics, b.three, b.mult], [9, 2, false, 2]);
  assert.equal(b.name.zh, '9 點兩公');
  const c = E('5S 5H AD');
  assert.deepEqual([c.points, c.pics, c.mult], [1, 0, 1]);
  assert.equal(c.name.zh, '1 點');
  assert.equal(E('TS TH TD').points, 0, '10 = 0 且不是公');
  assert.equal(E('TS TH TD').pics, 0);
  assert.equal(E('KS QH 7D').name.zh, '7 點兩公');
  assert.equal(E('8S KH 3C').points, 1);
});

test('三公 比牌：三公 > 9 > … > 0；同 8 點兩公 > 一公；點數與公數全同 → 莊勝（不比最高單張）', () => {
  assert.equal(compare(E('JS QH KD'), E('9S TH KD')).win, true, '三公 > 9 點');
  assert.equal(compare(E('9S TH KD'), E('JS QH KD')).win, false);
  assert.equal(compare(E('9S TH 2D'), E('8S TH 2D')).win, true);
  assert.equal(compare(E('AS TH 2D'), E('KS QH JD')).win, false, '3 點 < 三公');
  let r = compare(E('QD 8H JC'), E('8S KH TC'));
  assert.deepEqual([r.win, r.by], [true, 'pics'], '同 8 點：兩公 > 一公');
  r = compare(E('4H 4D QS'), E('8S KH TC'));
  assert.deepEqual([r.win, r.by], [false, 'tie'], '同 8 點一公：不比單張 → 莊勝');
  r = compare(E('8S KH TC'), E('4H 4D QS'));
  assert.deepEqual([r.win, r.by], [false, 'tie'], '同 8 點一公：玩家單張較大也不贏');
  r = compare(E('9C 9D KS'), E('8S KH TC'));
  assert.deepEqual([r.win, r.by], [false, 'tie'], '完全同 → 莊勝');
  r = compare(E('KS QS JS'), E('KH QH JH'));
  assert.deepEqual([r.win, r.by], [false, 'tie'], '三公對三公同最高 → 莊勝');
  r = compare(E('KS QS JS'), E('QH QD JH'));
  assert.deepEqual([r.win, r.by], [false, 'tie'], '三公對三公 → 莊勝');
});

test('三公 賠付：三公 3:1、9 點 2:1、其他 1:1；莊 9 點/三公輸 2/3 倍', () => {
  // 莊 7 點一公；位置 1 = 8 點；位置 2 = 9 點兩公；位置 3 = 5 點
  let r = settle([['seat-1', 100], ['seat-2', 100], ['seat-3', 100]], H('KS 3H 4D', '2C 5S AD', 'KH QD 9S', '7C 8D TH'));
  const by = Object.fromEntries(r.lines.map((l) => [l.seat, l]));
  assert.deepEqual([by[1].result, by[1].returned], ['win', 200]);
  assert.deepEqual([by[2].result, by[2].returned], ['win', 300]);
  assert.match(by[2].formula, /RM 100 × 2 = \+RM 200（拿回 RM 300）/);
  assert.deepEqual([by[3].result, by[3].pay], ['lose', -100]);
  assert.deepEqual([r.wagered, r.returned, r.extra, r.net], [300, 500, 0, 200]);
  r = settle([['seat-2', 100]], H('2S 3H 4D', 'AS AH AD', 'KH QD JS', 'AC AD 2H'));
  assert.deepEqual([r.returned, r.net], [400, 300], '三公 3:1');
  r = settle([['seat-2', 100]], H('KS QH JD', 'AS AH AD', '9H QD KS', 'AC AD 2H'));
  assert.deepEqual([r.returned, r.extra, r.net], [0, 200, -300], '莊三公輸 3 倍');
  r = settle([['seat-2', 100]], H('9S QH KD', 'AS AH AD', '8H QD KS', 'AC AD 2H'));
  assert.deepEqual([r.extra, r.net], [100, -200], '莊 9 點輸 2 倍');
  assert.equal(RULES.bankerMultiplier, true);
});

test('三公 發牌：1 副牌 12 張不重複', () => {
  LG.rng.seed(7);
  const h = dealHands();
  const ids = [...h.banker, ...h.seats[1], ...h.seats[2], ...h.seats[3]].map((c) => c.id);
  assert.equal(new Set(ids).size, 12);
  LG.rng.seed(null);
});

test('三公 Monte Carlo 100 萬局 [slow]', { skip: process.env.npm_lifecycle_event === 'test' }, () => {
  LG.rng.seed(123);
  const r = simulate(1000000);
  LG.rng.seed(null);
  assert.equal(r.rounds, 1000000);
  // 精確枚舉 4.1713%、和局率 3.776%；100 萬局標準誤約 0.12%
  assert.ok(r.edge > 3.5 && r.edge < 5, `優勢 ${r.edge}% 應約 4.2%（3.5–5）`);
  assert.ok(Math.abs(r.edge - MC_EDGE) < 0.4, `模擬 ${r.edge.toFixed(3)}% vs houseEdge ${MC_EDGE}%`);
  assert.ok(r.tieToBanker > 0.033 && r.tieToBanker < 0.043, `和局率 ${r.tieToBanker}`);
});

test('三公 教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create(fakeCtx());
  const lint = LG.tutorial.lint(inst.tutorialSteps());
  assert.deepEqual(lint.problems, []);
});

function fakeCtx(o = {}) {
  return {
    gameId: 'three-pictures', def, mode: 'tutorial', variant: '', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ...o,
  };
}
