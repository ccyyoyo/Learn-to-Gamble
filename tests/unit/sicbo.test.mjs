// 骰寶 Sic Bo：結算、216 種骰面 EV 枚舉、限注、教學規範
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['sicbo'] });
const def = LG.games.sicbo;
const { settle, multOf, allRolls, exactStats, specEdge, SPOT_IDS, winningSpots, callOf, REAL_LIMIT } = def.logic;

test('sicbo 註冊：spotId 齊全、houseEdge、限注', () => {
  assert.equal(def.category, 'table');
  assert.equal(SPOT_IDS.length, 4 + 6 + 6 + 6 + 1 + 14 + 15);
  for (const id of ['small', 'big', 'odd', 'even', 'anyTriple', 'total-4', 'total-17', 'combo-1-2', 'combo-5-6', 'single-6', 'double-3', 'triple-6']) assert.ok(SPOT_IDS.includes(id), id);
  assert.ok(!SPOT_IDS.includes('total-3') && !SPOT_IDS.includes('total-18'));
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 2.78);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 3000 });
  assert.equal(def.countdown, 20);
  assert.deepEqual(REAL_LIMIT.small, [25, 3000]);
  assert.deepEqual(REAL_LIMIT.single, [10, 1000]);
  assert.deepEqual(REAL_LIMIT.total, [10, 500]);
  assert.deepEqual(REAL_LIMIT.combo, [10, 500]);
  assert.deepEqual(REAL_LIMIT.double, [10, 300]);
  assert.deepEqual(REAL_LIMIT.triple, [10, 100]);
});

test('sicbo 216 種骰面枚舉：每注 EV 與規格優勢表一致（±0.01%）', () => {
  assert.equal(allRolls().length, 216);
  for (const id of SPOT_IDS) {
    // 直接用 settle 逐面計算（驗證結算函式本身）
    let net = 0;
    for (const d of allRolls()) net += settle([[id, 1]], d).net;
    const edge = (-net / 216) * 100;
    assert.ok(Math.abs(edge - specEdge(id)) <= 0.01, `${id}: 枚舉 ${edge.toFixed(4)}% vs 規格 ${specEdge(id)}%`);
    assert.ok(Math.abs(exactStats(id).edge - edge) < 1e-9);
  }
});

test('sicbo houseEdge 陣列數值都能在枚舉結果中找到', () => {
  const edges = new Set(SPOT_IDS.map((id) => exactStats(id).edge.toFixed(2)));
  for (const h of def.houseEdge) assert.ok(edges.has(h.edge.toFixed(2)), `${h.bet.zh} ${h.edge}`);
});

test('sicbo 大小遇圍骰輸；單點三顆 3:1', () => {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const d = [n, n, n];
    for (const id of ['small', 'big', 'odd', 'even']) assert.equal(multOf(id, d), -1, `${id} vs ${d}`);
    assert.equal(multOf(`single-${n}`, d), 3);
    assert.equal(multOf(`triple-${n}`, d), 180);
    assert.equal(multOf('anyTriple', d), 30);
    assert.equal(multOf(`double-${n}`, d), 10);
  }
  let r = settle([['big', 100]], [5, 5, 5]);
  assert.deepEqual([r.returned, r.net], [0, -100]);
  r = settle([['single-4', 100]], [4, 4, 4]);
  assert.deepEqual([r.returned, r.net], [400, 300]);
  r = settle([['single-4', 100]], [4, 4, 2]);
  assert.deepEqual([r.returned, r.net], [300, 200]);
  assert.match(r.lines[0].formula, /RM 100 × 2 = \+RM 200（拿回 RM 300）/);
});

test('sicbo 其他注別結算', () => {
  const r = settle([['small', 100], ['big', 100], ['odd', 50], ['total-14', 10], ['combo-3-5', 20], ['double-5', 10], ['single-6', 10]], [3, 5, 6]);
  const by = Object.fromEntries(r.lines.map((l) => [l.spot, l]));
  assert.equal(by.small.result, 'lose');
  assert.equal(by.big.returned, 200);
  assert.equal(by.odd.result, 'lose');
  assert.equal(by['total-14'].returned, 130);
  assert.equal(by['combo-3-5'].returned, 120);
  assert.equal(by['double-5'].result, 'lose');
  assert.equal(by['single-6'].returned, 20);
  assert.equal(r.wagered, 300);
  assert.equal(r.returned, 470);
  assert.equal(r.net, 170);
  assert.deepEqual(callOf([3, 5, 6]), { zh: '3、5、6 總點 14 大', en: 'Fourteen, Big' });
  const w = winningSpots([1, 2, 6]);
  assert.ok(w.has('combo-1-2') && w.has('combo-1-6') && w.has('combo-2-6') && w.has('small') && w.has('odd') && w.has('total-9'));
  assert.equal(w.get('single-1'), 1);
});

test('sicbo 真實模式限注套用到 Bets', () => {
  const inst = def.create(fakeCtx({ mode: 'real', isReal: true, limits: { min: 25, max: 3000 } }));
  const b = inst.bets;
  assert.deepEqual(b.limitFor('big'), { min: 25, max: 3000 });
  assert.deepEqual(b.limitFor('triple-3'), { min: 10, max: 100 });
  assert.deepEqual(b.limitFor('double-3'), { min: 10, max: 300 });
  assert.deepEqual(b.limitFor('combo-1-2'), { min: 10, max: 500 });
  assert.deepEqual(b.limitFor('single-1'), { min: 10, max: 1000 });
  assert.equal(b.place('triple-3', 100).ok, true);
  assert.equal(b.place('triple-3', 10).ok, false);
  b.clear();
  b.place('big', 10);
  assert.equal(b.validate().ok, false, '大小最低 25');
});

test('sicbo 教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
});

function fakeCtx(o = {}) {
  return {
    gameId: 'sicbo', def, mode: 'tutorial', variant: '', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ...o,
  };
}
